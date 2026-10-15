#!/usr/bin/env node
'use strict';
/**
 * Source 1 / Source 2 VPK 解析 + 批量提取器（Node 版，等价于 tools/vpk.py）
 *
 * 用法:
 *   node vpk_extract.js list    <dir.vpk> [子串过滤...]        # 列出条目（默认大小+路径）
 *   node vpk_extract.js info    <dir.vpk>                      # 头部/条目统计
 *   node vpk_extract.js extract <dir.vpk> <输出目录> [选项]      # 批量提取
 *
 * extract 选项:
 *   --exclude <内部路径>   排除该条目（可重复；大小写不敏感，'/' 与 '\' 等价）
 *   --exclude-prefix <p>   排除该前缀下的所有条目（可重复）
 *   --only <路径前缀>      只提取该前缀下的条目（可重复）
 *   --dry-run              只统计与检查，不写文件
 *   --manifest <文件>      把提取清单(JSON)写到该文件
 *   --quiet                少输出
 *
 * 格式说明（与 vpk.py 一致）:
 *   header : signature 0x55AA1234(LE) / version / (v2: treeSize,fileDataSize,
 *            archiveMd5Size,otherMd5Size,signatureSize)
 *   tree   : 以 '\0' 结尾的路径段，空段结束一层；条目 18 字节:
 *            crc32 u32 / preload u16 / archiveIndex u16 / offset u32 / length u32 / term u16
 *            preload 非 0 时，紧跟条目之后有 preload 字节，置于数据之前
 *   data   : archiveIndex == 0x7FFF -> <dir.vpk> 内 (fileDataOffset + offset)
 *            否则 -> <base>_NNN.vpk 内 (base = dir.vpk 去掉 '_dir.vpk')
 */

const fs = require('fs');
const path = require('path');

const VPK_SIGNATURE = 0x55aa1234;
const ARCHIVE_INDEX_EMBEDDED = 0x7fff;

// ---------------------------------------------------------------- 解析

function readHeader(fd) {
  const buf = Buffer.alloc(28);
  const n = fs.readSync(fd, buf, 0, 28, 0);
  if (n < 12) throw new Error('文件太小，不是 VPK');
  const signature = buf.readUInt32LE(0);
  if (signature !== VPK_SIGNATURE) {
    throw new Error('VPK 签名错误: 0x' + signature.toString(16).padStart(8, '0'));
  }
  const version = buf.readUInt32LE(4);
  let treeSize, headerSize;
  if (version === 1) {
    treeSize = buf.readUInt32LE(8);
    headerSize = 12;
  } else if (version === 2) {
    treeSize = buf.readUInt32LE(8);
    headerSize = 28;
  } else {
    throw new Error('不支持的 VPK 版本: ' + version);
  }
  return { signature, version, treeSize, headerSize };
}

/** 从 tree Buffer 中按游标读一个 '\0' 结尾的字符串 */
function readCString(tree, cursor) {
  const end = tree.indexOf(0, cursor);
  if (end < 0) throw new Error('目录树字符串未终止 (offset ' + cursor + ')');
  return { value: tree.toString('utf8', cursor, end), next: end + 1 };
}

function parseTree(tree) {
  const entries = [];
  let off = 0;
  for (;;) {
    const extR = readCString(tree, off);
    off = extR.next;
    const ext = extR.value;
    if (ext === '') break; // 结束树
    for (;;) {
      const pathR = readCString(tree, off);
      off = pathR.next;
      const dir = pathR.value;
      if (dir === '') break; // 下一层扩展名
      for (;;) {
        const nameR = readCString(tree, off);
        off = nameR.next;
        const name = nameR.value;
        if (name === '') break; // 下一层目录
        if (off + 18 > tree.length) throw new Error('目录树条目越界');
        const crc = tree.readUInt32LE(off);
        const preload = tree.readUInt16LE(off + 4);
        const archiveIndex = tree.readUInt16LE(off + 6);
        const offset = tree.readUInt32LE(off + 8);
        const length = tree.readUInt32LE(off + 12);
        // const terminator = tree.readUInt16LE(off + 16);
        off += 18;
        let preloadData = Buffer.alloc(0);
        if (preload) {
          if (off + preload > tree.length) throw new Error('preload 数据越界');
          preloadData = tree.subarray(off, off + preload);
          off += preload;
        }
        // Valve 对根目录写入的是一个空格 ' '（不是空串），必须归一化，
        // 否则会解出名为 " " 的垃圾目录。
        let cleanDir = dir.replace(/\\/g, '/');
        if (cleanDir === ' ' || cleanDir === '.' || cleanDir === '/') cleanDir = '';
        cleanDir = cleanDir.replace(/^\/+|\/+$/g, '');
        const full = (cleanDir ? cleanDir + '/' : '') + name + '.' + ext;
        entries.push({ path: full, crc, preload: preloadData, archiveIndex, offset, length });
      }
    }
  }
  return entries;
}

class Vpk {
  constructor(vpkPath) {
    this.path = path.resolve(vpkPath);
    this.fd = fs.openSync(this.path, 'r');
    const header = readHeader(this.fd);
    this.version = header.version;
    this.treeSize = header.treeSize;
    this.fileDataOffset = header.headerSize + header.treeSize;
    this.tree = Buffer.alloc(header.treeSize);
    if (header.treeSize > 0) {
      let got = 0;
      while (got < header.treeSize) {
        const n = fs.readSync(this.fd, this.tree, got, header.treeSize - got, header.headerSize + got);
        if (n <= 0) throw new Error('读取目录树失败');
        got += n;
      }
    }
    this.entries = parseTree(this.tree);
    this._archFds = new Map();
  }

  base() {
    // pak01_dir.vpk -> pak01   |   xyz.vpk -> xyz
    const dir = path.dirname(this.path);
    const bn = path.basename(this.path);
    const m = /^(.*)_dir\.vpk$/i.exec(bn);
    return path.join(dir, m ? m[1] : bn.replace(/\.vpk$/i, ''));
  }

  archivePath(archiveIndex) {
    return this.base() + '_' + String(archiveIndex).padStart(3, '0') + '.vpk';
  }

  entrySize(e) {
    return e.length + e.preload.length;
  }

  /** 读取整条数据（preload + archive chunk） */
  read(entry) {
    let chunk;
    if (entry.archiveIndex === ARCHIVE_INDEX_EMBEDDED) {
      chunk = Buffer.alloc(entry.length);
      const base = this.fileDataOffset + entry.offset;
      let got = 0;
      while (got < entry.length) {
        const n = fs.readSync(this.fd, chunk, got, entry.length - got, base + got);
        if (n <= 0) throw new Error('读取内嵌数据失败 @' + base);
        got += n;
      }
    } else {
      const ap = this.archivePath(entry.archiveIndex);
      let afd = this._archFds.get(ap);
      if (afd === undefined) {
        if (!fs.existsSync(ap)) {
          throw new Error('缺少分卷文件: ' + ap);
        }
        afd = fs.openSync(ap, 'r');
        this._archFds.set(ap, afd);
      }
      chunk = Buffer.alloc(entry.length);
      let got = 0;
      while (got < entry.length) {
        const n = fs.readSync(afd, chunk, got, entry.length - got, entry.offset + got);
        if (n <= 0) throw new Error('读取分卷数据失败 @' + ap + ':' + entry.offset);
        got += n;
      }
    }
    return entry.preload.length ? Buffer.concat([entry.preload, chunk]) : chunk;
  }

  close() {
    for (const fd of this._archFds.values()) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    this._archFds.clear();
    try { fs.closeSync(this.fd); } catch (_) {}
  }
}

/** 把 VPK 内部路径规范化成相对路径（去掉前导 '/'，统一 '/'） */
function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

// ---------------------------------------------------------------- 命令

function cmdList(argv) {
  const vpkPath = argv[0];
  const filters = argv.slice(1).map((s) => s.toLowerCase());
  const vpk = new Vpk(vpkPath);
  let n = 0;
  let total = 0;
  for (const e of vpk.entries.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const lp = e.path.toLowerCase();
    if (filters.length && !filters.every((f) => lp.includes(f))) continue;
    const size = vpk.entrySize(e);
    total += size;
    console.log(String(size).padStart(10) + '  ' + e.path);
    n++;
  }
  console.log('--- 共 ' + n + ' 项 / 总条目 ' + vpk.entries.length + ' / 总字节 ' + total + ' ---');
  vpk.close();
}

function cmdInfo(argv) {
  const vpk = new Vpk(argv[0]);
  const byTop = new Map();
  let total = 0;
  for (const e of vpk.entries) {
    const top = normalize(e.path).split('/')[0] || '(root)';
    byTop.set(top, (byTop.get(top) || 0) + 1);
    total += vpk.entrySize(e);
  }
  console.log('VPK: ' + vpk.path);
  console.log('version: ' + vpk.version + '  treeSize: ' + vpk.treeSize +
    '  fileDataOffset: ' + vpk.fileDataOffset);
  console.log('条目数: ' + vpk.entries.length + '  解包后总字节: ' + total +
    ' (' + (total / 1048576).toFixed(1) + ' MiB)');
  const rows = [...byTop.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) console.log('  ' + String(v).padStart(6) + '  ' + k);
  vpk.close();
}

function cmdExtract(argv) {
  const vpkPath = argv[0];
  const outRoot = path.resolve(argv[1]);
  const opts = { exclude: [], excludePrefix: [], only: [], dryRun: false, manifest: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--exclude') opts.exclude.push(normalize(argv[++i]).toLowerCase());
    else if (a === '--exclude-prefix') opts.excludePrefix.push(normalize(argv[++i]).toLowerCase());
    else if (a === '--only') opts.only.push(normalize(argv[++i]).toLowerCase());
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--manifest') opts.manifest = argv[++i];
    else if (a === '--quiet') opts.quiet = true;
    else throw new Error('未知选项: ' + a);
  }

  const vpk = new Vpk(vpkPath);
  const isExcluded = (p) => {
    const lp = p.toLowerCase();
    if (opts.exclude.includes(lp)) return true;
    for (const pre of opts.excludePrefix) {
      if (lp === pre || lp.startsWith(pre.endsWith('/') ? pre : pre + '/')) return true;
    }
    return false;
  };
  const isSelected = (p) => {
    if (!opts.only.length) return true;
    const lp = p.toLowerCase();
    return opts.only.some((pre) => lp === pre || lp.startsWith(pre.endsWith('/') ? pre : pre + '/'));
  };

  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  const failures = [];
  const byTop = new Map();
  let written = 0, bytes = 0, skipped = 0, maxLen = 0, maxLenPath = '';
  const manifest = [];
  const rootPrefixLen = outRoot.length + 1; // 含分隔符

  log('目标目录: ' + outRoot);
  log('VPK: ' + vpk.path + '  条目 ' + vpk.entries.length);

  for (const e of vpk.entries) {
    const rel = normalize(e.path);
    if (!isSelected(rel) || isExcluded(rel)) { skipped++; continue; }
    const full = path.join(outRoot, rel);
    // Windows MAX_PATH: 259 是资源编译器/工坊工具的硬限
    if (full.length > maxLen) { maxLen = full.length; maxLenPath = full; }
    if (full.length > 259) {
      failures.push({ path: rel, reason: 'path too long (' + full.length + ')', bytes: vpk.entrySize(e) });
      continue;
    }
    manifest.push({ path: rel, size: vpk.entrySize(e), archive: e.archiveIndex, offset: e.offset });
    if (opts.dryRun) {
      written++; bytes += vpk.entrySize(e);
      const top = rel.split('/')[0];
      byTop.set(top, (byTop.get(top) || 0) + 1);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const data = vpk.read(e);
      fs.writeFileSync(full, data);
      written++; bytes += data.length;
      const top = rel.split('/')[0];
      byTop.set(top, (byTop.get(top) || 0) + 1);
      if (written % 500 === 0) log('  ... 已写入 ' + written + ' 个文件 (' + (bytes / 1048576).toFixed(0) + ' MiB)');
    } catch (err) {
      failures.push({ path: rel, reason: String(err.message || err), bytes: vpk.entrySize(e) });
    }
  }
  vpk.close();

  const report = {
    vpk: vpk.path,
    outRoot,
    entriesInVpk: vpk.entries.length,
    written, skipped, bytes,
    maxPathLength: maxLen,
    maxPathSample: maxLenPath ? maxLenPath.slice(rootPrefixLen - 1) : null,
    topLevel: Object.fromEntries([...byTop.entries()].sort((a, b) => b[1] - a[1])),
    failures,
  };
  if (opts.manifest) fs.writeFileSync(opts.manifest, JSON.stringify(manifest, null, 1));

  console.log('=== 提取报告 ===');
  console.log('写入文件 : ' + written + '  跳过: ' + skipped + '  失败: ' + failures.length);
  console.log('写入字节 : ' + bytes + ' (' + (bytes / 1048576).toFixed(1) + ' MiB)');
  console.log('最长完整路径: ' + maxLen + ' 字符' + (maxLen >= 259 ? '  <<< 超过 MAX_PATH 259 !' : '  (OK, < 259)'));
  if (maxLenPath) console.log('  样例: ' + maxLenPath);
  console.log('顶层目录文件数:');
  for (const [k, v] of Object.entries(report.topLevel)) console.log('  ' + String(v).padStart(6) + '  ' + k);
  if (failures.length) {
    console.log('失败清单 (最多显示 40 条):');
    for (const f of failures.slice(0, 40)) console.log('  ! ' + f.path + '  ->  ' + f.reason);
  }
  return failures.length ? 1 : 0;
}

// ---------------------------------------------------------------- CRC32 校验

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 校验已解包目录：逐条比对 VPK 内记录的 crc32 与磁盘文件 */
function cmdVerify(argv) {
  const vpkPath = argv[0];
  const outRoot = path.resolve(argv[1]);
  let quiet = false;
  const only = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quiet') quiet = true;
    else if (a === '--only') only.push(normalize(argv[++i]).toLowerCase());
    else throw new Error('未知选项: ' + a);
  }
  const vpk = new Vpk(vpkPath);
  const mismatches = [];
  const missing = [];
  const sizeBad = [];
  let checked = 0, bytes = 0;
  for (const e of vpk.entries) {
    const rel = normalize(e.path);
    if (only.length && !only.some((p) => rel.toLowerCase().startsWith(p))) continue;
    const full = path.join(outRoot, rel);
    if (!fs.existsSync(full)) { missing.push(rel); continue; }
    const data = fs.readFileSync(full);
    if (data.length !== vpk.entrySize(e)) { sizeBad.push(rel + ' (size ' + data.length + ' != ' + vpk.entrySize(e) + ')'); continue; }
    const got = crc32(data);
    if (got !== e.crc) mismatches.push(rel + ' (crc ' + got.toString(16) + ' != ' + e.crc.toString(16) + ')');
    else { checked++; bytes += data.length; }
    if (!quiet && checked % 2000 === 0 && checked) process.stderr.write('  ... 已校验 ' + checked + '\n');
  }
  vpk.close();
  console.log('=== CRC 校验报告 ===');
  console.log('VPK: ' + vpk.path);
  console.log('目录: ' + outRoot);
  console.log('CRC 全部匹配 : ' + checked + ' 个文件, ' + bytes + ' 字节 (' + (bytes / 1048576).toFixed(1) + ' MiB)');
  console.log('CRC 不匹配   : ' + mismatches.length);
  mismatches.slice(0, 40).forEach((m) => console.log('  ! ' + m));
  console.log('大小不符     : ' + sizeBad.length);
  sizeBad.slice(0, 40).forEach((m) => console.log('  ! ' + m));
  console.log('文件缺失     : ' + missing.length);
  missing.slice(0, 40).forEach((m) => console.log('  - ' + m));
  return (mismatches.length || sizeBad.length) ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2) {
    console.log('用法:\n  node vpk_extract.js list    <dir.vpk> [过滤...]\n' +
      '  node vpk_extract.js info    <dir.vpk>\n' +
      '  node vpk_extract.js extract <dir.vpk> <输出目录> [--exclude p] [--exclude-prefix p] [--only p] [--dry-run] [--manifest f] [--quiet]\n' +
      '  node vpk_extract.js verify  <dir.vpk> <已解包目录> [--only p] [--quiet]');
    return 64;
  }
  const cmd = argv[0];
  try {
    if (cmd === 'list') { cmdList(argv.slice(1)); return 0; }
    if (cmd === 'info') { cmdInfo(argv.slice(1)); return 0; }
    if (cmd === 'extract') return cmdExtract(argv.slice(1));
    if (cmd === 'verify') return cmdVerify(argv.slice(1));
    console.error('未知命令: ' + cmd);
    return 64;
  } catch (e) {
    console.error('错误: ' + (e && e.message ? e.message : e));
    return 1;
  }
}

if (require.main === module) process.exit(main());
module.exports = { Vpk, normalize };
