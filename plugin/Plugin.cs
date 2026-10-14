// OldWeaponSounds —— CS2 每武器枪声开关（配合 soundevents addon）
//
// 背景：
//   addon(soundevents/soundevents_addon.vsndevts) 把 Weapon_XXX.Single 覆盖成 CS:GO 旧音，
//   所以**默认所有玩家听到的都是 CS:GO 旧音**。本插件只负责"把某些武器还原成 CS2 原声"。
//
// 语义：
//   总开关 enabled=false        -> 插件完全不干预（全部武器都是 addon 的旧音）
//   武器 enabled=true  (默认)   -> 插件什么都不做，原版开火音效消息照常发出 -> 客户端播 addon 的旧音
//   武器 enabled=false          -> 插件拦下该武器的原版开火音效消息(452)，
//                                  先播放 Orig_Weapon_XXX.Single(内容=CS2 原事件)，拿到非 0 guid 才屏蔽原版
//                                  —— 任何一步失败都保留原版消息，绝不出现"无声枪"
//
// 命令：
//   css_oldws status                    查看状态
//   css_oldws <item_def_index> on|off   开/关某把武器的 CS:GO 旧音（off = 还原 CS2 原声）
//   css_oldws reload                    重新读取配置文件
//   css_oldws list                      列出所有关闭（还原成 CS2 原声）的武器

using System.Text;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.UserMessages;
using CounterStrikeSharp.API.Modules.Utils;

namespace OldWeaponSounds;

public class WeaponCfg
{
    /// <summary>显示名（仅用于日志/命令输出）。</summary>
    public string name { get; set; } = "";

    /// <summary>items_game.txt 里的武器类名，如 weapon_ak47。用于 weapon_fire 事件关联。</summary>
    public string weapon_name { get; set; } = "";

    /// <summary>物品定义索引（= config 里的 key）。PartyHorn 没有该索引，为 null。</summary>
    public int? item_def_index { get; set; }

    /// <summary>addon 覆盖后指向 CS:GO 旧音的事件名。</summary>
    public string legacy_event { get; set; } = "";

    /// <summary>addon 里内容与 CS2 原事件完全一致的事件名，用于还原 CS2 原声。</summary>
    public string orig_event { get; set; } = "";

    /// <summary>true = 保持 CS:GO 旧音（插件不干预）；false = 还原成 CS2 原声。</summary>
    public bool enabled { get; set; } = true;
}

public class RootCfg
{
    /// <summary>插件总开关。false 时完全不干预任何音效。</summary>
    public bool enabled { get; set; } = true;

    /// <summary>诊断日志。</summary>
    public bool debug { get; set; } = true;

    /// <summary>按 item_def_index 索引的武器表。</summary>
    public Dictionary<string, WeaponCfg> weapons { get; set; } = new();
}

public class OldWeaponSoundsPlugin : BasePlugin
{
    public override string ModuleName => "OldWeaponSounds";
    public override string ModuleVersion => "2.0.0";
    public override string ModuleAuthor => "dsh";
    public override string ModuleDescription => "CS:GO 旧版枪声 addon 的每武器开关（把指定武器还原成 CS2 原声）";

    /// <summary>武器开火音效 usermessage（fields: weapon_id / sound_type / item_def_index）。</summary>
    private const int MsgWeaponFireSound = 452;

    /// <summary>原始诊断日志条数上限，避免刷爆日志。</summary>
    private const int MaxRawDiagnostics = 300;

    /// <summary>日志超过该字节数时在加载阶段归档。</summary>
    private const long MaxLogBytes = 2 * 1024 * 1024;

    private static readonly object FileLock = new();
    private static string _logPath = "";

    private RootCfg _cfg = new();
    private string _cfgPath = "";

    /// <summary>weapon_fire 记录，用于把 452 关联到开枪玩家（defIndex -> player, 时间）。</summary>
    private readonly List<(int DefIndex, CCSPlayerController Player, DateTime At)> _pending = new();

    private int _rawLogged;
    private long _replaced;       // 成功还原成 CS2 原声的次数
    private long _suppressFailed; // 还原失败、保留原版音效的次数
    private int _msgSeen;

    // ---------------------------------------------------------------- 生命周期

    public override void Load(bool hotReload)
    {
        _logPath = Path.Combine(ModuleDirectory, "oldweaponsounds.log");
        _cfgPath = ResolveConfigPath();
        RotateLog();

        Log($"=== OldWeaponSounds v2.0 加载 (hotReload={hotReload}) ===");
        LoadConfig();

        HookUserMessage(MsgWeaponFireSound, OnWeaponFireSound, HookMode.Pre);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire, HookMode.Pre);

        Log($"配置: 总开关={_cfg.enabled} debug={_cfg.debug} 武器条目={_cfg.weapons.Count} " +
            $"还原成CS2原声的武器={DisabledCount()} 保持CS:GO旧音的武器={EnabledCount()}");
    }

    private void RotateLog()
    {
        try
        {
            if (File.Exists(_logPath) && new FileInfo(_logPath).Length > MaxLogBytes)
                File.Move(_logPath, _logPath + ".old", true);
        }
        catch { }
    }

    private static void Log(string msg)
    {
        try
        {
            lock (FileLock)
                File.AppendAllText(_logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_cfgPath))
            {
                _cfg = new RootCfg();
                SaveConfig();
                Log($"未找到配置，已生成默认配置: {_cfgPath}");
                return;
            }

            var json = File.ReadAllText(_cfgPath, Encoding.UTF8);
            var opts = new JsonSerializerOptions
            {
                ReadCommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true,
                PropertyNameCaseInsensitive = true,
            };
            _cfg = JsonSerializer.Deserialize<RootCfg>(json, opts) ?? new RootCfg();
            _cfg.weapons ??= new Dictionary<string, WeaponCfg>();

            // 兼容：config 里漏写事件名时按名字补全
            foreach (var kv in _cfg.weapons)
            {
                var w = kv.Value;
                if (string.IsNullOrEmpty(w.name)) w.name = kv.Key;
                if (string.IsNullOrEmpty(w.legacy_event)) w.legacy_event = $"Weapon_{w.name}.Single";
                if (string.IsNullOrEmpty(w.orig_event)) w.orig_event = $"Orig_{w.name}.Single";
            }
        }
        catch (Exception e)
        {
            // 读配置失败时保持"不干预"，此时玩家听到的是 addon 的 CS:GO 旧音（不是无声）
            Log("读取配置失败，使用默认值(不干预任何武器): " + e.Message);
            _cfg = new RootCfg { enabled = false, debug = true };
        }
    }

    /// <summary>
    /// 配置路径遵循 CounterStrikeSharp 惯例：
    ///   &lt;counterstrikesharp&gt;/configs/plugins/&lt;插件名&gt;/&lt;插件名&gt;.json
    /// 若发现早期放在插件目录下的 config.json，则自动迁移到惯例位置。
    /// 这样升级插件（整目录替换）时不会覆盖用户的配置。
    /// </summary>
    private string ResolveConfigPath()
    {
        // ModuleDirectory = <counterstrikesharp>/plugins/<插件名>，上溯两级即 <counterstrikesharp>
        var cssRoot = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", ".."));
        var preferred = Path.Combine(cssRoot, "configs", "plugins", ModuleName, ModuleName + ".json");
        var legacy = Path.Combine(ModuleDirectory, "config.json");

        if (File.Exists(preferred)) return preferred;

        if (File.Exists(legacy))
        {
            try
            {
                var dir = Path.GetDirectoryName(preferred);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.Copy(legacy, preferred);
                Log($"配置已从插件目录迁移到惯例位置: {preferred}");
                return preferred;
            }
            catch (Exception e)
            {
                Log($"迁移配置失败，继续沿用旧位置: {e.Message}");
                return legacy;
            }
        }

        return preferred;   // 全新安装：在惯例位置生成
    }

    private void SaveConfig()
    {
        try
        {
            var dir = Path.GetDirectoryName(_cfgPath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var header =
                $"// OldWeaponSounds 配置{Environment.NewLine}" +
                $"// 路径遵循 CounterStrikeSharp 惯例: configs/plugins/{ModuleName}/{ModuleName}.json{Environment.NewLine}" +
                $"// weapons.<def_index>.enabled = true  → 保持 addon 提供的 CS:GO 旧音{Environment.NewLine}" +
                $"//                             = false → 还原为 CS2 原声（由插件拦截并重播 Orig_ 事件）{Environment.NewLine}";

            File.WriteAllText(_cfgPath, header + JsonSerializer.Serialize(_cfg, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
        }
        catch (Exception e) { Log("保存配置失败: " + e.Message); }
    }

    private int DisabledCount() => _cfg.weapons.Values.Count(w => !w.enabled);
    private int EnabledCount() => _cfg.weapons.Values.Count(w => w.enabled);

    // ------------------------------------------------ weapon_fire：记录"谁开了什么枪"

    private HookResult OnWeaponFire(EventWeaponFire e, GameEventInfo info)
    {
        try
        {
            var p = e.Userid;
            if (p == null || !p.IsValid) return HookResult.Continue;

            var di = FindDefIndex(e.Weapon);
            if (di < 0) return HookResult.Continue;

            lock (_pending)
            {
                _pending.Add((di, p, DateTime.UtcNow));
                _pending.RemoveAll(x => (DateTime.UtcNow - x.At).TotalSeconds > 2.0);
            }
        }
        catch (Exception ex) { Log("weapon_fire 异常: " + ex.Message); }
        return HookResult.Continue;
    }

    private int FindDefIndex(string weaponName)
    {
        if (string.IsNullOrEmpty(weaponName)) return -1;
        foreach (var kv in _cfg.weapons)
            if (string.Equals(kv.Value.weapon_name, weaponName, StringComparison.OrdinalIgnoreCase))
                return int.TryParse(kv.Key, out var d) ? d : -1;
        return -1;
    }

    // ------------------------------------------------ 452：武器开火音效消息

    private HookResult OnWeaponFireSound(UserMessage um)
    {
        try
        {
            _msgSeen++;

            if (!_cfg.enabled) return HookResult.Continue;

            var idi = um.HasField("item_def_index") ? um.ReadInt("item_def_index") : int.MinValue;
            if (idi == int.MinValue) return HookResult.Continue;

            // 查表：表里没有 / enabled=true -> 什么都不做，客户端播 addon 的 CS:GO 旧音
            if (!_cfg.weapons.TryGetValue(idi.ToString(), out var wc)) return HookResult.Continue;
            if (wc.enabled) return HookResult.Continue;

            var wid = um.HasField("weapon_id") ? um.ReadInt("weapon_id") : -1;
            var st = um.HasField("sound_type") ? um.ReadInt("sound_type") : -1;

            if (_cfg.debug && _rawLogged < MaxRawDiagnostics)
            {
                _rawLogged++;
                Log($"452 weapon_id={wid} sound_type={st} item_def_index={idi}({wc.name}) -> 该武器要还原成 CS2 原声");
            }

            // 1) 定位开枪者实体（位置音效必需）
            var shooter = ResolveShooter(wid, idi);
            if (shooter == null)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) 未定位到开枪者，不做任何替换（不会无声）");
                return HookResult.Continue;
            }

            var pawn = shooter.PlayerPawn?.Value;
            if (pawn == null || !pawn.IsValid)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) 开枪者 pawn 无效，不做任何替换（不会无声）");
                return HookResult.Continue;
            }

            // 2) 先发出 CS2 原声事件（Orig_ 事件与原事件逐字段相同，仅事件名不同）
            var recipients = new RecipientFilter();
            recipients.AddAllPlayers();
            var guid = pawn.EmitSound(wc.orig_event, recipients, 1.0f);

            // 3) 只有拿到非 0 guid 才屏蔽原版消息
            if (guid == 0)
            {
                _suppressFailed++;
                Log($"[保留原版] {wc.name}(def={idi}) EmitSound(\"{wc.orig_event}\") 返回 guid=0，保留原版音效（不会无声）");
                return HookResult.Continue;
            }

            _replaced++;
            if (_cfg.debug)
                Log($"[已还原] {wc.name}(def={idi}) 玩家=\"{shooter.PlayerName}\" -> {wc.orig_event} guid={guid}，已屏蔽原版消息");

            return HookResult.Handled;
        }
        catch (Exception ex)
        {
            Log("452 处理异常(已放行原版): " + ex);
            return HookResult.Continue;
        }
    }

    /// <summary>
    /// 定位开枪者：
    ///   A. 把 weapon_id 当实体索引 -> OwnerEntity（玩家则直接返回，pawn 则反查控制器）
    ///   B. weapon_fire 事件记录的 (defIndex -> player) FIFO，取 1 秒内最近的一条
    /// 都失败返回 null（调用方会保留原版音效）。
    /// </summary>
    private CCSPlayerController ResolveShooter(int weaponId, int defIndex)
    {
        // 策略 A
        try
        {
            var ent = Utilities.GetEntityFromIndex<CBaseEntity>(weaponId);
            if (ent != null && ent.IsValid)
            {
                var owner = ent.OwnerEntity?.Value;
                if (owner != null && owner.IsValid)
                {
                    if (owner.DesignerName == "player")
                    {
                        var ctrl = owner.As<CCSPlayerController>();
                        if (ctrl != null && ctrl.IsValid) return ctrl;
                    }
                    foreach (var p in Utilities.GetPlayers())
                        if (p.IsValid && p.PlayerPawn?.Value?.Index == owner.Index) return p;
                }
            }
        }
        catch { }

        // 策略 B
        lock (_pending)
        {
            var now = DateTime.UtcNow;
            for (var i = _pending.Count - 1; i >= 0; i--)
            {
                var x = _pending[i];
                if (!x.Player.IsValid)
                {
                    _pending.RemoveAt(i);
                    continue;
                }
                if (x.DefIndex == defIndex && (now - x.At).TotalSeconds < 1.0)
                {
                    _pending.RemoveAt(i);
                    return x.Player;
                }
            }
            // 清理过期记录
            _pending.RemoveAll(x => (now - x.At).TotalSeconds > 2.0);
        }

        return null;
    }

    // ---------------------------------------------------------------- 命令

    [ConsoleCommand("css_oldws", "旧版枪声每武器开关: css_oldws status | css_oldws <item_def_index> on|off | css_oldws reload | css_oldws list")]
    public void OnOldWsCommand(CCSPlayerController? player, CommandInfo info)
    {
        var a1 = info.ArgCount > 1 ? info.GetArg(1).Trim().ToLowerInvariant() : "status";

        switch (a1)
        {
            case "reload":
                LoadConfig();
                info.ReplyToCommand($"[OldWeaponSounds] 配置已重载: 总开关={_cfg.enabled} 武器条目={_cfg.weapons.Count} 还原CS2原声={DisabledCount()}");
                return;

            case "list":
                {
                    var restored = _cfg.weapons.Where(kv => !kv.Value.enabled).Select(kv => $"{kv.Value.name}({kv.Key})").ToList();
                    info.ReplyToCommand(restored.Count == 0
                        ? "[OldWeaponSounds] 当前没有武器被还原成 CS2 原声（全部使用 CS:GO 旧音）"
                        : $"[OldWeaponSounds] 还原成 CS2 原声 ({restored.Count}): {string.Join(", ", restored)}");
                    return;
                }

            case "status":
                info.ReplyToCommand($"[OldWeaponSounds] 总开关={_cfg.enabled} debug={_cfg.debug} 武器条目={_cfg.weapons.Count} " +
                                    $"保持CS:GO旧音={EnabledCount()} 还原CS2原声={DisabledCount()}");
                info.ReplyToCommand($"[OldWeaponSounds] 已处理 452 消息={_msgSeen} 成功还原={_replaced} 还原失败(保留原版)={_suppressFailed}");
                info.ReplyToCommand("[OldWeaponSounds] 用法: css_oldws <item_def_index> on|off （on=CS:GO旧音, off=CS2原声）");
                return;
        }

        // css_oldws <item_def_index> on|off
        if (!int.TryParse(a1, out var defIndex))
        {
            info.ReplyToCommand("[OldWeaponSounds] 用法: css_oldws status | css_oldws list | css_oldws <item_def_index> on|off | css_oldws reload");
            return;
        }

        if (!_cfg.weapons.TryGetValue(defIndex.ToString(), out var wc))
        {
            info.ReplyToCommand($"[OldWeaponSounds] 未找到 item_def_index={defIndex} 的武器");
            return;
        }

        if (info.ArgCount <= 2)
        {
            info.ReplyToCommand($"[OldWeaponSounds] {wc.name}({defIndex}) 当前={(wc.enabled ? "CS:GO 旧音" : "CS2 原声")}；" +
                                $"用法: css_oldws {defIndex} on|off");
            return;
        }

        var a2 = info.GetArg(2).Trim().ToLowerInvariant();
        var isOn = a2 is "on" or "1" or "true" or "yes" or "enable";
        var isOff = a2 is "off" or "0" or "false" or "no" or "disable";
        if (!isOn && !isOff)
        {
            info.ReplyToCommand($"[OldWeaponSounds] 参数要 on 或 off，收到 \"{a2}\"");
            return;
        }

        wc.enabled = isOn;
        SaveConfig();
        info.ReplyToCommand($"[OldWeaponSounds] {wc.name}({defIndex}) -> {(isOn ? "CS:GO 旧音(插件不干预)" : "CS2 原声(插件拦截并播放 Orig 事件)")}");
        Log($"命令: {wc.name}(def={defIndex}) enabled={wc.enabled} 操作者={(player?.PlayerName ?? "服务端控制台")}");
    }
}
