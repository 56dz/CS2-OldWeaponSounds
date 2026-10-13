#!/usr/bin/env python3
"""Source 1 / Source 2 VPK 通用解析器
用法:
  vpk.py list <dir.vpk> [子串过滤...]
  vpk.py extract <dir.vpk> <内部路径> <输出文件>
"""
import struct
import sys
import os


def read_cstr(buf, off):
    end = buf.index(b'\0', off)
    return buf[off:end].decode('utf-8', 'replace'), end + 1


class VPK:
    def __init__(self, path):
        self.path = path
        with open(path, 'rb') as f:
            self.data = f.read()
        data = self.data
        sig, ver = struct.unpack_from('<II', data, 0)
        if sig != 0x55AA1234:
            raise ValueError('VPK 签名错误: 0x%08X' % sig)
        self.version = ver
        off = 8
        if ver == 1:
            tree_size, = struct.unpack_from('<I', data, off)
            off += 4
        elif ver == 2:
            (tree_size, file_data_size, arch_md5_size,
             other_md5_size, sig_size) = struct.unpack_from('<IIIII', data, off)
            off += 20
        else:
            raise ValueError('不支持的 VPK 版本: %d' % ver)
        self.tree_size = tree_size
        self.file_data_off = off + tree_size
        self.entries = {}
        self._parse(off)

    def _parse(self, off):
        data = self.data
        while True:
            ext, off = read_cstr(data, off)
            if ext == '':
                break
            while True:
                path, off = read_cstr(data, off)
                if path == '':
                    break
                while True:
                    name, off = read_cstr(data, off)
                    if name == '':
                        break
                    crc, preload, arch, eoff, elen, term = struct.unpack_from(
                        '<IHHIIH', data, off)
                    off += 18
                    preload_data = b''
                    if preload:
                        preload_data = data[off:off + preload]
                        off += preload
                    full = (path + '/' if path else '') + name + '.' + ext
                    self.entries[full] = (crc, preload_data, arch, eoff, elen)

    def _archive_path(self, arch):
        # pak01_dir.vpk -> pak01_003.vpk
        base = self.path[:-8]
        return '%s_%03d.vpk' % (base, arch)

    def read(self, full):
        crc, preload, arch, eoff, elen = self.entries[full]
        if arch == 0x7FFF:
            base = self.file_data_off + eoff
            chunk = self.data[base:base + elen]
        else:
            with open(self._archive_path(arch), 'rb') as f:
                f.seek(eoff)
                chunk = f.read(elen)
        return preload + chunk


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 64
    cmd = sys.argv[1]
    vpk = VPK(sys.argv[2])

    if cmd == 'list':
        filters = [a.lower() for a in sys.argv[3:]]
        n = 0
        for k in sorted(vpk.entries):
            kl = k.lower()
            if filters and not all(f in kl for f in filters):
                continue
            crc, preload, arch, eoff, elen = vpk.entries[k]
            size = elen + len(preload)
            print('%10d  %s' % (size, k))
            n += 1
        print('--- 共 %d 项 (总条目 %d) ---' % (n, len(vpk.entries)))
        return 0

    if cmd == 'extract':
        if len(sys.argv) < 5:
            print('用法: vpk.py extract <dir.vpk> <内部路径> <输出文件>')
            return 64
        internal, out = sys.argv[3], sys.argv[4]
        if internal not in vpk.entries:
            print('未找到: %s' % internal, file=sys.stderr)
            return 1
        blob = vpk.read(internal)
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, 'wb') as f:
            f.write(blob)
        print('已提取 %d 字节 -> %s' % (len(blob), out))
        return 0

    print('未知命令: %s' % cmd, file=sys.stderr)
    return 64


if __name__ == '__main__':
    sys.exit(main())
