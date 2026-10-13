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
    public string name { get; set; } = "";
    public string weapon_name { get; set; } = "";
    public string vsnd { get; set; } = "";
    public string soundevent { get; set; } = "";
    public float volume { get; set; } = 1.0f;
}

public class RootCfg
{
    /// <summary>总开关。false 时插件完全不干预（原版音效照常）。</summary>
    public bool enabled { get; set; } = false;

    /// <summary>
    /// 替换方式：
    ///   none       = 只诊断，不改动任何音效（默认，最安全）
    ///   soundevent = 播放 soundevent（需配合 addon 覆盖，方位/衰减正确；推荐）
    ///   vsnd       = 直接播 .vsnd 路径（无需 addon，但可能丢失 3D 定位）
    /// </summary>
    public string replaceMode { get; set; } = "none";

    /// <summary>是否在替换成功后屏蔽原版开火音（避免双重音）。</summary>
    public bool suppressVanilla { get; set; } = true;

    /// <summary>诊断日志（首次调试建议 true）。</summary>
    public bool debug { get; set; } = true;

    public Dictionary<string, WeaponCfg> weapons { get; set; } = new();
}

public class OldWeaponSoundsPlugin : BasePlugin
{
    public override string ModuleName => "OldWeaponSounds";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "dsh";
    public override string ModuleDescription => "将武器开火音效替换为 CS:GO 旧版音效";

    private static readonly object FileLock = new();
    private static string _logPath;
    private RootCfg _cfg = new();
    private string _cfgPath;

    /// <summary>已记录但尚未匹配到音效消息的开火（用于关联 452 与开火玩家）。</summary>
    private readonly List<(int defIndex, CCSPlayerController player, DateTime at)> _pending = new();

    private static void Log(string msg)
    {
        try
        {
            lock (FileLock)
                File.AppendAllText(_logPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }

    public override void Load(bool hotReload)
    {
        _logPath = Path.Combine(ModuleDirectory, "oldweaponsounds.log");
        _cfgPath = Path.Combine(ModuleDirectory, "config.json");
        Log($"=== OldWeaponSounds v1.0 加载 (hotReload={hotReload}) ===");

        LoadConfig();

        HookUserMessage(452, OnWeaponFireSound, HookMode.Pre);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire, HookMode.Pre);

        Log($"配置: enabled={_cfg.enabled} mode={_cfg.replaceMode} suppress={_cfg.suppressVanilla} 武器数={_cfg.weapons.Count}");
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_cfgPath))
            {
                _cfg = new RootCfg { enabled = false, replaceMode = "none", debug = true };
                File.WriteAllText(_cfgPath, JsonSerializer.Serialize(_cfg,
                    new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
                Log($"未找到配置，已生成默认配置: {_cfgPath}");
                return;
            }
            var json = File.ReadAllText(_cfgPath, Encoding.UTF8);
            _cfg = JsonSerializer.Deserialize<RootCfg>(json) ?? new RootCfg();
            foreach (var kv in _cfg.weapons)
                if (string.IsNullOrEmpty(kv.Value.soundevent))
                    kv.Value.soundevent = $"Weapon_{kv.Value.name}.Single";
        }
        catch (Exception e)
        {
            Log("读取配置失败，使用安全默认值: " + e.Message);
            _cfg = new RootCfg { enabled = false, replaceMode = "none", debug = true };
        }
    }

    // ---------- 开火事件：记录"谁开了什么枪"，供 452 关联 ----------
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
                // 只保留最近 2 秒的记录，避免无限增长
                _pending.RemoveAll(x => (DateTime.UtcNow - x.at).TotalSeconds > 2.0);
            }
            if (_cfg.debug) Log($"EVT weapon_fire player=\"{p.PlayerName}\" weapon={e.Weapon} defIdx={di}");
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

    // ---------- 452：武器开火音效消息 ----------
    private HookResult OnWeaponFireSound(UserMessage um)
    {
        try
        {
            int wid = um.HasField("weapon_id") ? um.ReadInt("weapon_id") : -1;
            int st = um.HasField("sound_type") ? um.ReadInt("sound_type") : -1;
            int idi = um.HasField("item_def_index") ? um.ReadInt("item_def_index") : -1;

            if (_cfg.debug)
            {
                string entInfo;
                try
                {
                    var ent = Utilities.GetEntityFromIndex<CBaseEntity>(wid);
                    entInfo = (ent != null && ent.IsValid)
                        ? $"{ent.DesignerName}(owner={(ent.OwnerEntity?.Value?.Index.ToString() ?? "-")})"
                        : "无效实体";
                }
                catch (Exception ex) { entInfo = "解析异常:" + ex.GetType().Name; }
                Log($"UM452 weapon_id={wid} sound_type={st} item_def_index={idi} | weapon_id→{entInfo}");
            }

            if (!_cfg.enabled) return HookResult.Continue;
            if (!_cfg.weapons.TryGetValue(idi.ToString(), out var wc)) return HookResult.Continue;

            // 找出开枪者：优先用 weapon_id 当实体索引解析，其次用 weapon_fire 记录关联
            var shooter = ResolveShooter(wid, idi);
            if (shooter == null)
            {
                if (_cfg.debug) Log($"未定位到开枪者 defIdx={idi}，放弃替换（避免无声）");
                return HookResult.Continue;   // 安全兜底：不做任何改动
            }

            var pawn = shooter.PlayerPawn?.Value;
            if (pawn == null || !pawn.IsValid)
            {
                if (_cfg.debug) Log("开枪者 pawn 无效，放弃替换");
                return HookResult.Continue;
            }

            var rf = new RecipientFilter();
            rf.AddAllPlayers();

            // 先播音，拿到 guid 再决定是否屏蔽原版 —— 失败则保留原版，绝不产生无声
            uint guid;
            if (_cfg.replaceMode == "vsnd" && !string.IsNullOrEmpty(wc.vsnd))
                guid = pawn.EmitSound(wc.vsnd, rf, wc.volume);
            else if (_cfg.replaceMode == "soundevent")
                guid = pawn.EmitSound(wc.soundevent, rf, wc.volume);
            else
                return HookResult.Continue;   // none：只诊断

            if (_cfg.debug)
                Log($"已发射旧音效 [{wc.name}] mode={_cfg.replaceMode} guid={guid} 开枪者=\"{shooter.PlayerName}\"");

            if (guid != 0 && _cfg.suppressVanilla)
            {
                if (_cfg.debug) Log("屏蔽原版开火音（返回 Handled）");
                return HookResult.Handled;
            }
            return HookResult.Continue;
        }
        catch (Exception ex)
        {
            Log("UM452 异常: " + ex.Message);
            return HookResult.Continue;
        }
    }

    private CCSPlayerController ResolveShooter(int weaponId, int defIndex)
    {
        // 策略 A：weapon_id 是武器实体索引
        try
        {
            var ent = Utilities.GetEntityFromIndex<CBaseEntity>(weaponId);
            if (ent != null && ent.IsValid)
            {
                var owner = ent.OwnerEntity?.Value;
                if (owner != null && owner.IsValid)
                {
                    var ctrl = owner.DesignerName == "player"
                        ? owner.As<CCSPlayerController>()
                        : null;
                    if (ctrl != null && ctrl.IsValid) return ctrl;
                    // 属主是 pawn 时反查控制器
                    foreach (var p in Utilities.GetPlayers())
                        if (p.PlayerPawn?.Value?.Index == owner.Index) return p;
                }
            }
        }
        catch { }

        // 策略 B：用 weapon_fire 记录按 defIndex 关联（FIFO，最近的优先）
        lock (_pending)
        {
            var now = DateTime.UtcNow;
            for (int i = _pending.Count - 1; i >= 0; i--)
            {
                var x = _pending[i];
                if (x.defIndex == defIndex && (now - x.at).TotalSeconds < 1.0)
                {
                    _pending.RemoveAt(i);
                    return x.player;
                }
            }
        }
        return null;
    }

    // ---------- 命令 ----------
    [ConsoleCommand("css_oldws", "旧版枪声开关: css_oldws <0|1> | status | reload")]
    public void OnCmd(CCSPlayerController? player, CommandInfo info)
    {
        var arg = info.ArgCount > 1 ? info.GetArg(1).ToLower() : "status";

        if (arg == "reload")
        {
            LoadConfig();
            info.ReplyToCommand($"[OldWeaponSounds] 配置已重载: enabled={_cfg.enabled} mode={_cfg.replaceMode} 武器数={_cfg.weapons.Count}");
            return;
        }
        if (arg == "status")
        {
            info.ReplyToCommand($"[OldWeaponSounds] enabled={_cfg.enabled} mode={_cfg.replaceMode} suppress={_cfg.suppressVanilla} 武器数={_cfg.weapons.Count}");
            info.ReplyToCommand("[OldWeaponSounds] 要启用请执行 css_oldws 1（需先挂载 soundevents addon 才能听到旧音色）");
            return;
        }
        if (arg == "0" || arg == "1")
        {
            _cfg.enabled = arg == "1";
            try
            {
                File.WriteAllText(_cfgPath, JsonSerializer.Serialize(_cfg,
                    new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
            }
            catch (Exception e) { Log("保存配置失败: " + e.Message); }
            info.ReplyToCommand($"[OldWeaponSounds] enabled={_cfg.enabled}");
            Log($"命令切换 enabled={_cfg.enabled}");
            return;
        }
        info.ReplyToCommand("[OldWeaponSounds] 用法: css_oldws <0|1|status|reload>");
    }
}
