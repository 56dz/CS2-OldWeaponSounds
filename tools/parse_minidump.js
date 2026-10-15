#!/usr/bin/env node
/**
 * parse_minidump.js — 纯 Node.js（无依赖）只读解析 Windows minidump (.dmp)
 * 针对 Steam/CS2 写出的 crash dump 做了布局实测校对（见文末“布局校对说明”）。
 *
 * 用法:
 *   node tools/parse_minidump.js                     # 解析默认的 3 个 CS2 dump
 *   node tools/parse_minidump.js <file.dmp> [...]     # 解析指定 dump
 *   node tools/parse_minidump.js --json <file.dmp>    # 只输出 JSON
 *   node tools/parse_minidump.js --stack <file.dmp>   # 附带完整栈扫描
 *   node tools/parse_minidump.js --comment <file.dmp> # 附带 CommentStream 全文
 *
 * 只读: 仅 fs.readFileSync / statSync，不写文件、不启动任何进程。
 *
 * 流类型（dbghelp MINIDUMP_STREAM_TYPE 实测）:
 *   3 ThreadList / 4 ModuleList / 5 MemoryList / 6 Exception / 7 SystemInfo /
 *   9 Memory64List / 13 FunctionTable / 14 UnloadedModuleList / 15 MiscInfo /
 *   10 CommentStreamA (Steam 的崩溃注释文本，含 Addons/Map/Uptime)
 *
 * 布局校对说明（本 dump 实测，非文档推断）:
 *   1) ExceptionStream = {ThreadId u32, pad u32, **原生 EXCEPTION_RECORD(152B)**:
 *      ExceptionCode u32 @+8, Flags u32 @+12, Record u64 @+16, **Address u64 @+24**,
 *      NumberParameters u32 @+32, pad u32 @+36, ExceptionInformation[15] u64 @+40,
 *      ThreadContext {DataSize u32, Rva u32} @+160} — DataSize 实测 = 0x4D0 = 1232 = x64 CONTEXT
 *   2) MINIDUMP_STRING 实测: 长度是 **u32**(字节数)，缓冲区在 +4（不是文档的 u64/+8）
 *   3) MINIDUMP_THREAD 实测 48 字节: tid(4) suspend(4) priority(4) pad(4) teb u64(8)
 *      stack.start u64(8) stack.DataSize u32(4) stack.Rva u32(4) ctx.DataSize(4) ctx.Rva(4)
 *      —— 线程栈描述符与 MemoryListStream 条目实测一致
 *   4) UnloadedModuleList: SizeOfHeader u32 / SizeOfEntry u32 / NumberOfEntries u32 + 条目
 *   5) SystemInfo: ProcessorArchitecture 是 u16 @0 (9 = AMD64)
 *   6) x64 CONTEXT: Rip @0xF8, Rsp @0x98, Rbp @0xA0, Rax @0x78 (与微软 CONTEXT 一致)
 */

'use strict';
const fs = require('fs');
const path = require('path');

const MDMP_SIG = 0x504d444d; // "MDMP"
const STREAM = {
  0: 'UnusedStream', 1: 'ReservedStream0', 2: 'ReservedStream1',
  3: 'ThreadListStream', 4: 'ModuleListStream', 5: 'MemoryListStream',
  6: 'ExceptionStream', 7: 'SystemInfoStream', 8: 'ThreadExListStream',
  9: 'Memory64ListStream', 10: 'CommentStreamA', 11: 'CommentStreamW',
  12: 'HandleDataStream', 13: 'FunctionTableStream', 14: 'UnloadedModuleListStream',
  15: 'MiscInfoStream', 16: 'MemoryInfoListStream', 17: 'ThreadInfoListStream',
  18: 'HandleOperationListStream', 19: 'TokenStream',
};
const EXCEPTION_CODES = {
  0x40000015: 'STATUS_FATAL_APP_EXIT',
  0x80000003: 'BREAKPOINT',
  0x80000004: 'SINGLE_STEP',
  0xc0000005: 'ACCESS_VIOLATION (非法读/写/执行)',
  0xc0000006: 'IN_PAGE_ERROR',
  0xc0000008: 'INVALID_HANDLE',
  0xc000001d: 'ILLEGAL_INSTRUCTION',
  0xc0000025: 'NONCONTINUABLE_EXCEPTION',
  0xc0000094: 'INTEGER_DIVIDE_BY_ZERO',
  0xc0000095: 'INTEGER_OVERFLOW',
  0xc00000fd: 'STACK_OVERFLOW (栈溢出)',
  0xc0000135: 'DLL_NOT_FOUND',
  0xc0000138: 'ORDINAL_NOT_FOUND',
  0xc0000142: 'DLL_INIT_FAILED',
  0xc0000374: 'HEAP_CORRUPTION',
  0xc0000409: 'STACK_BUFFER_OVERRUN / FAIL_FAST',
  0xc0000417: 'INVALID_CRUNTIME_PARAMETER',
  0xe06d7363: 'CPP_EXCEPTION (C++ throw 0xE06D7363 "msc")',
  0xe0434352: 'CLR_EXCEPTION (.NET)',
};

const CTX = {
  ContextFlags: 0x00, EFlags: 0x44,
  Rax: 0x78, Rcx: 0x80, Rdx: 0x88, Rbx: 0x90,
  Rsp: 0x98, Rbp: 0xa0, Rsi: 0xa8, Rdi: 0xb0,
  R8: 0xb8, R9: 0xc0, R10: 0xc8, R11: 0xd0,
  R12: 0xd8, R13: 0xe0, R14: 0xe8, R15: 0xf0,
  Rip: 0xf8,
};

const hex = (v, w = 8) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(w, '0');
const hexn = (v) => '0x' + BigInt(v).toString(16).toUpperCase();
const decodeCode = (c) => EXCEPTION_CODES[c >>> 0] ||
  (((c & 0xffff0000) === 0xc0000000) ? 'NTSTATUS/SEH 异常(未收录)' :
    ((c & 0xf0000000) === 0xe0000000) ? '用户定义 C++/SEH 异常(未收录)' : '未知异常码');
const tsToDate = (ts) => ts ? new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z/, 'Z') : 'n/a';
const tsToLocal = (ts) => ts ? new Date(ts * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z/, 'Z') + ' (UTC)' : 'n/a';

function parseDump(file, opts) {
  const buf = fs.readFileSync(file);
  const out = { file, fileSize: buf.length, streams: [], errors: [], warnings: [] };
  const u32 = (o) => buf.readUInt32LE(o);
  const u64 = (o) => buf.readBigUInt64LE(o);
  const u16 = (o) => buf.readUInt16LE(o);
  const u8 = (o) => buf[o];
  const i32 = (o) => buf.readInt32LE(o);

  // ---- MINIDUMP_HEADER ----
  if (u32(0) !== MDMP_SIG) { out.errors.push('签名非 MDMP'); return out; }
  const numStreams = u32(8), dirRva = u32(12);
  out.header = {
    signature: 'MDMP', version: hex(u32(4)), numberOfStreams: numStreams,
    timeDateStamp: hex(u32(20)), timeDateUtc: tsToLocal(u32(20)),
    checkSum: hex(u32(16)), flags: hexn(u64(24)),
  };

  const S = [];
  for (let i = 0; i < numStreams; i++) {
    const o = dirRva + i * 12;
    if (o + 12 > buf.length) break;
    S.push({ index: i, type: u32(o), name: STREAM[u32(o)] || `Unknown(${u32(o)})`, size: u32(o + 4), rva: u32(o + 8) });
  }
  out.streams = S;
  const by = (t) => S.find(s => s.type === t);

  // ---- 字符串 (u32 长度, +4) ----
  const strAt = (rva) => {
    if (!rva || rva + 4 > buf.length) return '';
    const L = Math.min(u32(rva), 4096);
    if (rva + 4 + L > buf.length) return '';
    return buf.toString('utf16le', rva + 4, rva + 4 + L).replace(/\0+$/, '');
  };

  // ---- SystemInfo (7) ----
  const si = by(7);
  if (si) {
    const arch = u16(si.rva);
    const archName = { 0: 'x86', 5: 'ARM', 6: 'IA64', 9: 'AMD64 (x64)', 12: 'ARM64' }[arch] || `arch#${arch}`;
    out.systemInfo = {
      processorArchitecture: archName, numberOfProcessors: u8(si.rva + 6),
      productType: u8(si.rva + 7),
      majorVersion: u32(si.rva + 8), minorVersion: u32(si.rva + 12),
      buildNumber: u32(si.rva + 16), platformId: u32(si.rva + 20),
      csdVersion: strAt(u32(si.rva + 24)),
    };
    const s = out.systemInfo;
    s.osVersion = `${s.majorVersion}.${s.minorVersion}.${s.buildNumber}`;
  }

  // ---- ModuleList (4) ----
  const modules = [];
  const ml = by(4);
  if (ml) {
    const n = u32(ml.rva);
    for (let i = 0; i < n; i++) {
      const m = ml.rva + 4 + i * 108;
      if (m + 108 > buf.length) break;
      const base = u64(m), size = u32(m + 8), sum = u32(m + 12), ts = u32(m + 16);
      const name = strAt(u32(m + 20));
      let ver = null;
      if (u32(m + 24) === 0xfeef04bd) {
        const ms = u32(m + 32), ls = u32(m + 36);
        const v = (x) => `${(x >>> 16) & 0xffff}.${(x >>> 0) & 0xffff}`;
        ver = { file: `${v(ms)}.${v(ls)}`, product: `${v(u32(m + 40))}.${v(u32(m + 44))}` };
      }
      modules.push({
        index: i, base, baseHex: hexn(base), size, end: base + BigInt(size),
        checkSum: hex(sum), timeDateStamp: ts, timeDate: tsToDate(ts),
        name, nameBase: name.split(/[\\/]/).pop(), version: ver,
      });
    }
  }
  out.moduleCount = modules.length;

  function findModule(addr) {
    for (const m of modules) if (addr >= m.base && addr < m.end) return m;
    return null;
  }

  // ---- MemoryList (5) / Memory64List (9) ----
  const memRanges = []; // {start:BigInt, size:BigInt, rva:Number}
  const mem5 = by(5);
  if (mem5) {
    const n = u32(mem5.rva);
    for (let i = 0; i < n && i < 4096; i++) {
      const p = mem5.rva + 4 + i * 16;
      if (p + 16 > buf.length) break;
      memRanges.push({ start: u64(p), size: BigInt(u32(p + 8)), rva: u32(p + 12) });
    }
    out.memoryStream = { kind: 'MemoryListStream(5)', ranges: n };
  }
  const mem9 = by(9);
  if (mem9) {
    const n = Number(u64(mem9.rva));
    let acc = u64(mem9.rva + 8);
    for (let i = 0; i < n && i < 4096; i++) {
      const p = mem9.rva + 16 + i * 16;
      if (p + 16 > buf.length) break;
      memRanges.push({ start: u64(p), size: u64(p + 8), rva: Number(acc) });
      acc += u64(p + 8);
    }
    out.memoryStream = { kind: 'Memory64ListStream(9)', ranges: n, baseRva: hexn(u64(mem9.rva + 8)) };
  }

  // ---- ThreadList (3), 实测 48 字节/条 ----
  const threads = [];
  const tl = by(3);
  if (tl) {
    const n = u32(tl.rva);
    const stride = tl.size > 4 && n > 0 ? Math.floor((tl.size - 4) / n) : 48;
    out.threadListStride = stride;
    for (let i = 0; i < n && i < 2048; i++) {
      const p = tl.rva + 4 + i * stride;
      if (p + stride > buf.length) break;
      const t = {
        i, threadId: u32(p), suspendCount: u32(p + 4), priorityClass: u32(p + 8),
      };
      if (stride >= 48) {
        t.teb = hexn(u64(p + 16));
        t.stackStart = u64(p + 24);
        t.stackDataSize = u32(p + 32);
        t.stackRva = u32(p + 36);
        t.ctxSize = u32(p + 40);
        t.ctxRva = u32(p + 44);
      } else if (stride >= 40) {
        t.teb = hex(u32(p + 12));
        t.stackStart = u64(p + 16);
        t.stackDataSize = u32(p + 24);
        t.stackRva = u32(p + 28);
        t.ctxSize = u32(p + 32);
        t.ctxRva = u32(p + 36);
      }
      threads.push(t);
    }
  }
  out.threadCount = threads.length;

  // ---- UnloadedModuleList (14) ----
  const um = by(14);
  if (um) {
    const hdr = u32(um.rva), entry = u32(um.rva + 4), cnt = u32(um.rva + 8);
    const list = [];
    if (entry >= 24) {
      for (let i = 0; i < cnt && i < 512; i++) {
        const p = um.rva + hdr + i * entry;
        if (p + 24 > buf.length) break;
        list.push({ base: hexn(u64(p)), size: u32(p + 8), timeDate: tsToDate(u32(p + 16)), name: strAt(u32(p + 20)) });
      }
    }
    out.unloadedModules = { sizeOfHeader: hdr, sizeOfEntry: entry, entries: list };
  }

  // ---- ExceptionStream (6), 实测原生 EXCEPTION_RECORD ----
  const es = by(6);
  if (!es) out.errors.push('无 ExceptionStream — 该 dump 不含崩溃异常');
  else if (es.rva + 168 <= buf.length) {
    const ex = { threadId: u32(es.rva), layout: null };
    // 探测: 原生布局下 @160 处 ThreadContext.DataSize 应为 1232 (0x4D0)
    const ctxSizeAt160 = u32(es.rva + 160);
    if (ctxSizeAt160 === 1232 || ctxSizeAt160 === 0x4d0) {
      ex.layout = 'native EXCEPTION_RECORD (code u32 @+8, address u64 @+24, ThreadContext @+160)';
      ex.exceptionCode = u32(es.rva + 8);
      ex.exceptionFlags = u32(es.rva + 12);
      ex.exceptionRecord = hexn(u64(es.rva + 16));
      ex.exceptionAddress = u64(es.rva + 24);
      ex.numberParameters = u32(es.rva + 32);
      ex.exceptionInformation = [];
      for (let k = 0; k < Math.min(ex.numberParameters, 15); k++) ex.exceptionInformation.push(hexn(u64(es.rva + 40 + k * 8)));
      ex.ctxSize = ctxSizeAt160;
      ex.ctxRva = u32(es.rva + 164);
    } else {
      // 文档布局 (MINIDUMP_EXCEPTION, u64 code): code @+8, address @+32, ctx @+168 超出流
      ex.layout = 'documented MINIDUMP_EXCEPTION (u64 code @+8, address @+32)';
      ex.exceptionCode = Number(u64(es.rva + 8) & 0xffffffffn);
      ex.exceptionFlags = Number(u64(es.rva + 16));
      ex.exceptionRecord = hexn(u64(es.rva + 24));
      ex.exceptionAddress = u64(es.rva + 32);
      ex.numberParameters = u32(es.rva + 40);
      ex.exceptionInformation = [];
      for (let k = 0; k < Math.min(ex.numberParameters, 15); k++) ex.exceptionInformation.push(hexn(u64(es.rva + 48 + k * 8)));
      ex.ctxSize = null; ex.ctxRva = null;
      out.warnings.push('ExceptionStream 未按原生布局，ThreadContext 无法定位');
    }
    ex.exceptionCodeHex = hex(ex.exceptionCode);
    ex.decoded = decodeCode(ex.exceptionCode);
    ex.exceptionAddressHex = hexn(ex.exceptionAddress);
    if (ex.exceptionCode === 0xc0000005 && ex.numberParameters >= 1) {
      const t = Number(BigInt(ex.exceptionInformation[0]));
      // EXCEPTION_READ_FAULT=0, EXCEPTION_WRITE_FAULT=1, EXCEPTION_DEP_FAULT=8
      ex.avType = { 0: 'READ(读)', 1: 'WRITE(写)', 8: 'EXEC/DEP(执行)' }[t] || `type=${ex.exceptionInformation[0]}`;
      ex.avAddress = ex.exceptionInformation[1] || null;
    }

    // CONTEXT
    if (ex.ctxRva && ex.ctxSize >= 1232 && ex.ctxRva + 1232 <= buf.length) {
      const c = (o) => hexn(u64(ex.ctxRva + o));
      ex.context = {
        _rip: u64(ex.ctxRva + CTX.Rip), _rsp: u64(ex.ctxRva + CTX.Rsp), _rbp: u64(ex.ctxRva + CTX.Rbp),
        Rip: c(CTX.Rip), Rsp: c(CTX.Rsp), Rbp: c(CTX.Rbp), Rax: c(CTX.Rax),
        Rcx: c(CTX.Rcx), Rdx: c(CTX.Rdx), Rbx: c(CTX.Rbx), Rsi: c(CTX.Rsi), Rdi: c(CTX.Rdi),
        R8: c(CTX.R8), R9: c(CTX.R9), R10: c(CTX.R10), R11: c(CTX.R11),
        R12: c(CTX.R12), R13: c(CTX.R13), R14: c(CTX.R14), R15: c(CTX.R15),
        EFlags: hex(u32(ex.ctxRva + CTX.EFlags)),
      };
      ex.ctxSource = `ExceptionStream.ThreadContext @ rva 0x${ex.ctxRva.toString(16)} (size ${ex.ctxSize})`;
      if (ex.context._rip !== ex.exceptionAddress)
        out.warnings.push(`CONTEXT.RIP(${hexn(ex.context._rip)}) != ExceptionAddress(${ex.exceptionAddressHex})`);
    } else out.errors.push('无法从该 dump 提取出错线程 CONTEXT');

    // 故障模块
    const fm = findModule(ex.exceptionAddress);
    ex.faultModule = fm ? {
      name: fm.name, nameBase: fm.nameBase, base: fm.baseHex,
      offset: hexn(ex.exceptionAddress - fm.base), offsetDec: Number(ex.exceptionAddress - fm.base),
      sizeHex: hex(fm.size), timeDate: fm.timeDate, version: fm.version,
    } : null;
    out.exception = ex;
  }

  // ---- CommentStreamA (10): Steam 崩溃注释 ----
  const cs = by(10);
  if (cs && cs.size > 0) {
    const text = buf.toString('utf8', cs.rva, cs.rva + Math.min(cs.size, 262144));
    out.comment = text;
    const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
    out.commentHighlights = {
      crash: /^Crash/m.test(text) ? 'Crash' : null,
      uptime: grab(/Uptime\(\s*([^\)]+)\)/),
      totalFrames: grab(/Total frames\(\s*([^\)]+)\)/),
      curtime: grab(/Curtime\(\s*([^\)]+)\)/),
      realtime: grab(/Realtime\(\s*([^\)]+)\)/),
      currentMap: grab(/Current Map:\s*'([^\']*)'/),
      addons: grab(/Addons:\s*(.*)/),
      commandLine: grab(/Command Line:\s*(.*)/),
      build: grab(/Build:\s*(.*)/),
      os: grab(/OS:\s*(.*)/),
      time: grab(/Time:\s*(.*)/),
      gpu: grab(/Driver Name:\s*(.*)/),
      renderSystem: grab(/Render system:\s*(.*)/),
      net: grab(/Net:\s*(.*)/),
    };
    if (opts && opts.comment) out.commentFull = text;
  }

  // ---- 栈提取 ----
  if (out.exception && out.exception.context) {
    const rsp = out.exception.context._rsp, rbp = out.exception.context._rbp;
    const rg = memRanges.find(g => rsp >= g.start && rsp < g.start + g.size);
    const stack = { rspAvailable: !!rg };
    if (rg) {
      stack.rangeStart = hexn(rg.start);
      stack.rangeSize = Number(rg.size);
      stack.rangeRva = hex(rg.rva);
      const off = Number(rsp - rg.start);
      const cap = Math.min(Number(rg.size) - off, 0x8000);
      const data = buf.subarray(Number(rg.rva) + off, Number(rg.rva) + off + cap);
      stack.bytesScanned = data.length;
      stack.walkFromRsp = [];
      for (let i = 0; i + 8 <= data.length; i += 8) {
        const v = data.readBigUInt64LE(i);
        const m = findModule(v);
        if (m && v > m.base) stack.walkFromRsp.push({
          rspOff: i, addr: hexn(v), module: m.nameBase,
          offset: hexn(v - m.base), offsetDec: Number(v - m.base),
        });
      }
      // RBP 帧链
      stack.framePointerChain = [];
      let cur = rbp;
      for (let d = 0; d < 32; d++) {
        const r2 = memRanges.find(g => cur >= g.start && cur < g.start + g.size);
        if (!r2) break;
        const o2 = Number(cur - r2.start);
        if (o2 + 16 > Number(r2.size)) break;
        const at = Number(r2.rva) + o2;
        const next = buf.readBigUInt64LE(at), ret = buf.readBigUInt64LE(at + 8);
        const m = findModule(ret);
        stack.framePointerChain.push({
          frame: d, rbp: hexn(cur), ret: hexn(ret),
          module: m ? m.nameBase : '(不在模块列表)', offset: m ? hexn(ret - m.base) : null,
        });
        if (next <= cur || next - cur > 0x100000n) break;
        cur = next;
      }
      // 全栈按模块统计
      const counts = {};
      for (let i = 0; i + 8 <= data.length; i += 8) {
        const m = findModule(data.readBigUInt64LE(i));
        if (m) counts[m.nameBase] = (counts[m.nameBase] || 0) + 1;
      }
      stack.moduleHits = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    } else {
      stack.note = `RSP=${hexn(rsp)} 不在任何已包含的内存区间内 → 该 dump 未保存出错线程栈`;
    }
    out.stack = stack;
  }

  // ---- 磁盘文件 mtime（只读 stat） ----
  const searchDirs = [
    'D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64',
    'D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\bin\\win64',
    'D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo\\bin',
    'D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin',
    'D:\\Program Files\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\platform\\bin\\win64',
    'D:\\Program Files\\Steam\\steamapps\\workshop\\content\\730\\3819972417',
    'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
    'D:\\Program Files\\Steam',
  ];
  const statCache = new Map();
  function locateOnDisk(bn) {
    if (statCache.has(bn)) return statCache.get(bn);
    let res = null;
    for (const d of searchDirs) {
      try {
        const p = path.join(d, bn);
        const st = fs.statSync(p);
        if (st.isFile()) { res = { path: p, mtime: st.mtime.toISOString().replace('T', ' ').replace(/\.\d+Z/, 'Z'), size: st.size }; break; }
      } catch (e) { /* skip */ }
    }
    statCache.set(bn, res);
    return res;
  }
  out.modules = modules.map(m => {
    const d = locateOnDisk(m.nameBase);
    return { ...m, diskPath: d ? d.path : null, diskMtime: d ? d.mtime : null, diskSize: d ? d.size : null };
  });
  for (const m of out.modules) { delete m.base; delete m.end; }

  out.threads = threads.map(t => ({
    threadId: t.threadId, suspendCount: t.suspendCount,
    stackStart: t.stackStart !== undefined ? hexn(t.stackStart) : null,
    stackDataSize: t.stackDataSize, hasContext: !!(t.ctxRva),
  }));
  return out;
}

// ---------- 打印 ----------
const KEY_MOD = /^(cs2\.exe|engine2\.dll|client\.dll|server\.dll|host\.dll|vphysics2\.dll|resourcesystem\.dll|scenesystem\.dll|inputsystem\.dll|panorama\.dll|panoramauiclient\.dll|videoservices\.dll|particles\.dll|rendersystemdx11\.dll|shaderapidx9\.dll|materialsystem2\.dll|soundsystem\.dll|navsystem\.dll|predictionsystem\.dll|worldrenderer\.dll|tier0_s64\.dll|vstdlib_s64\.dll|filesystem_stdio\.dll|gameoverlayrenderer64\.dll|ntdll\.dll|kernel32\.dll|d3d11\.dll|vulkan|dxgi\.dll|westrook|lib[a-z0-9_-]+\.dll|v8[a-z0-9_.-]*\.dll)$/i;

function printReport(res, opts) {
  const L = (s) => console.log(s || '');
  L('='.repeat(104));
  L(`DUMP : ${res.file}`);
  L(`  大小=${res.fileSize} bytes  转储时间=${res.header.timeDateUtc}  Flags=${res.header.flags}  流数=${res.header.numberOfStreams}`);
  L('  流目录: ' + res.streams.map(s => `${s.type}:${s.name.replace(/Stream$/, '')}(${s.size})`).join(' '));
  if (res.systemInfo) L(`  系统: ${res.systemInfo.processorArchitecture} ×${res.systemInfo.numberOfProcessors} / Windows ${res.systemInfo.osVersion} "${res.systemInfo.csdVersion || ''}"`);
  if (res.memoryStream) L(`  内存流: ${res.memoryStream.kind}, ranges=${res.memoryStream.ranges}`);
  L(`  线程: ${res.threadCount} 条 (记录步长 ${res.threadListStride} 字节)   模块: ${res.moduleCount} 个`);
  const ex = res.exception;
  if (!ex) { L('  !! 无异常信息'); return; }
  L('--- 异常 ---');
  L(`  ExceptionCode   : ${ex.exceptionCodeHex}  ${ex.decoded}`);
  L(`  ExceptionFlags  : ${hex(ex.exceptionFlags)}   NumberParameters=${ex.numberParameters}   ExceptionRecord=${ex.exceptionRecord}`);
  L(`  ExceptionAddress: ${ex.exceptionAddressHex}${ex.avType ? `   [${ex.avType} @ ${ex.avAddress || '?'}]` : ''}`);
  if (ex.numberParameters && ex.exceptionInformation.length) L(`  ExceptionInformation: ${ex.exceptionInformation.join(', ')}`);
  L(`  解析布局       : ${ex.layout}`);
  L(`  出错线程       : ThreadId=${ex.threadId}`);
  if (ex.context) {
    const c = ex.context;
    L(`  CONTEXT (${ex.ctxSource}):`);
    L(`    RIP=${c.Rip}  RSP=${c.Rsp}  RBP=${c.Rbp}  RAX=${c.Rax}`);
    L(`    RBX=${c.Rbx} RCX=${c.Rcx} RDX=${c.Rdx} RSI=${c.Rsi} RDI=${c.Rdi} EFlags=${c.EFlags}`);
    L(`    R8=${c.R8} R9=${c.R9} R12=${c.R12} R13=${c.R13} R15=${c.R15}`);
  } else L('  CONTEXT: 无法从该 dump 提取');
  L('--- 故障模块 ---');
  if (ex.faultModule) {
    const f = ex.faultModule;
    L(`  ${f.name}`);
    L(`    基址=${f.base}  模块内偏移=${f.offset} (${f.offsetDec} bytes)  模块大小=${f.sizeHex}`);
    L(`    TimeDateStamp=${f.timeDate}  VS版本=${f.version ? f.version.file : '无版本资源'}`);
    const disk = res.modules.find(m => m.nameBase === f.nameBase);
    if (disk && disk.diskPath) L(`    磁盘文件=${disk.diskPath}  mtime=${disk.diskMtime}  size=${disk.diskSize}`);
  } else L('  ExceptionAddress 不在任何已加载模块内（堆/栈/已卸载模块）');
  L('--- 关键模块（dump 模块列表） ---');
  for (const m of res.modules) {
    if (KEY_MOD.test(m.nameBase)) {
      L(`  ${m.nameBase.padEnd(24)} base=${m.baseHex} size=0x${m.size.toString(16).padStart(7, '0')} ts=${m.timeDate} ver=${m.version ? m.version.file : '-'} disk=${m.diskMtime || '未定位'}`);
    }
  }
  if (res.unloadedModules && res.unloadedModules.entries.length) {
    L(`--- UnloadedModuleList (header=${res.unloadedModules.sizeOfHeader}, entry=${res.unloadedModules.sizeOfEntry}) ---`);
    for (const u of res.unloadedModules.entries) L(`  ${u.name}  base=${u.base} size=0x${u.size.toString(16)} ts=${u.timeDate}`);
  }
  if (res.commentHighlights) {
    const h = res.commentHighlights;
    L('--- 崩溃注释 (CommentStreamA) 摘要 ---');
    L(`  Time=${h.time}  Uptime=${h.uptime}s  TotalFrames=${h.totalFrames}  Curtime=${h.curtime}  Realtime=${h.realtime}`);
    L(`  Map='${h.currentMap}'  Addons=${h.addons}  SpawnCount 相关见全文`);
    L(`  Build=${h.build}  Cmd=${h.commandLine}`);
    L(`  OS=${h.os}  Render=${h.renderSystem}  GPU=${h.gpu}  Net=${h.net}`);
  }
  if (res.stack) {
    const s = res.stack;
    L('--- 出错线程栈 ---');
    if (!s.rspAvailable) { L(`  ${s.note || '栈内存未包含在 dump 中'}`); }
    else {
      L(`  栈区间 ${s.rangeStart} size=${s.rangeSize} rva=${s.rangeRva}  自 RSP 扫描 ${s.bytesScanned} 字节`);
      L('  [返回地址候选] 自 RSP 起顺序:');
      const show = opts && opts.stack ? s.walkFromRsp : s.walkFromRsp.slice(0, 25);
      for (const e of show) L(`    [rsp+0x${e.rspOff.toString(16).padStart(4, '0')}] ${e.addr}  ${e.module} + ${e.offset}`);
      if (s.walkFromRsp.length > show.length) L(`    ... 共 ${s.walkFromRsp.length} 个（--stack 显示全部）`);
      L('  [RBP 帧指针链] 逐帧返回地址:');
      for (const f of s.framePointerChain) L(`    #${f.frame}  rbp=${f.rbp}  ret=${f.ret}  ${f.module}${f.offset ? ' + ' + f.offset : ''}`);
      L('  [栈内指针按模块统计]');
      for (const [k, v] of s.moduleHits) L(`    ${k.padEnd(26)} ${v}`);
    }
  }
  if (res.errors.length) L('  [提取失败字段] ' + res.errors.join(' ; '));
  if (res.warnings.length) L('  [警告] ' + res.warnings.join(' ; '));
  L('');
}

function main() {
  const args = process.argv.slice(2);
  const opts = { json: false, stack: false, comment: false };
  const files = [];
  for (const a of args) {
    if (a === '--json') opts.json = true;
    else if (a === '--stack') opts.stack = true;
    else if (a === '--comment') opts.comment = true;
    else if (a === '-h' || a === '--help') { console.log('用法: node parse_minidump.js [--json] [--stack] [--comment] <dump.dmp> ...'); process.exit(0); }
    else files.push(a);
  }
  if (!files.length) files.push(
    'D:\\Program Files\\Steam\\dumps\\crash_cs2.exe_20261015134135_1.dmp',
    'D:\\Program Files\\Steam\\dumps\\crash_cs2.exe_20261015161650_1.dmp',
    'D:\\Program Files\\Steam\\dumps\\crash_cs2.exe_20261015162852_1.dmp',
  );
  const results = [];
  for (const f of files) {
    try { const r = parseDump(f, opts); results.push(r); if (!opts.json) printReport(r, opts); }
    catch (e) { console.error(`解析失败 ${f}: ${e.stack}`); results.push({ file: f, fatal: e.message }); }
  }
  if (opts.json) {
    console.log(JSON.stringify(results, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
    return;
  }
  if (results.length > 1) {
    console.log('='.repeat(104));
    console.log('汇总 / 同源性比较:');
    for (const r of results) {
      const e = r.exception || {};
      const fm = e.faultModule;
      console.log(`  ${path.basename(r.file).padEnd(42)} ${e.exceptionCodeHex || '?'} ${String(e.decoded || '').slice(0, 20).padEnd(22)} ${fm ? fm.nameBase + ' + ' + fm.offset : '?'}  RIP=${e.exceptionAddressHex || '?'}  tid=${e.threadId ?? '?'}  ${r.header ? r.header.timeDateUtc : ''}`);
    }
    const mods = results.map(r => r.exception && r.exception.faultModule ? r.exception.faultModule.nameBase + '+' + r.exception.faultModule.offset : null);
    const codes = results.map(r => r.exception ? r.exception.exceptionCodeHex : null);
    console.log(`  → 故障模块+偏移是否一致: ${mods.every(m => m && m === mods[0]) ? '是 (' + mods[0] + ')' : '否 ' + JSON.stringify(mods)}`);
    console.log(`  → 异常码是否一致: ${codes.every(c => c && c === codes[0]) ? '是 (' + codes[0] + ')' : '否 ' + JSON.stringify(codes)}`);
  }
}
main();

/**
 * 布局校对依据（可复现）:
 *   node -e "..." 读 crash_cs2.exe_20261015162852_1.dmp:
 *   - ExceptionStream @0x684: +8 = 0xC0000005, +24 = 0x7FFA2C1B6DAF, +32 = 2 (AV 恒为 2 参数),
 *     +160 = 0x4D0(1232 = x64 CONTEXT 大小), +164 = 0xFDF0 → CONTEXT @0xFDF0 的 RIP 与 +24 完全一致
 *   - 模块名 rva 0xAA1A: u32=188 字节 = "D:\...\cs2.exe"(93 字符+NUL)×2 ✓, 缓冲区在 +4
 *   - ThreadList size 3988 = 4 + 83×48 ✓; 线程栈描述符 (0x8E241DB0B8, 20296, 0x686FC)
 *     与 MemoryListStream 条目 #1 完全一致, 且包含 RSP=0x8E241DCE70 ✓
 */
