#!/usr/bin/env python3
"""把 3819972417 从 appworkshop_730.acf 的两段里摘除（unpin），
让 CS2 内置 Steam 不再遍历/校验这个 item，从而不把未过审的新包回滚。
用法: python3 _acf_unpin.py <acf路径> <workshop_id>
"""
import re
import sys
import shutil
import time


def find_block(text, start):
    """start 指向 '{' 的位置，返回配平的结束位置（含）。"""
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def drop_block(text, section, wid):
    """在 section 里定位 <wid> {...} 并删除整段（含前面的 tab 缩进）。"""
    m = re.search(r'"%s"\s*\n(\s*)\{' % re.escape(section), text)
    if not m:
        print('  段 %s 不存在' % section)
        return text, False
    sec_open = text.index('{', m.end() - 1)
    sec_close = find_block(text, sec_open)
    if sec_close < 0:
        print('  段 %s 花括号不配平' % section)
        return text, False
    body = text[sec_open:sec_close + 1]

    pat = re.compile(r'\n(\t+)"%s"[ \t]*\n\1\{' % re.escape(wid))
    mm = pat.search(body)
    if not mm:
        print('  %s 里没有 %s' % (section, wid))
        return text, False
    item_open = body.index('{', mm.end() - 1)
    item_close = find_block(body, item_open)
    if item_close < 0:
        print('  %s 的块花括号不配平' % wid)
        return text, False

    new_body = body[:mm.start()] + body[item_close + 1:]
    return text[:sec_open] + new_body + text[sec_close + 1:], True


def main():
    if len(sys.argv) < 3:
        print('用法: python3 _acf_unpin.py <acf路径> <workshop_id>')
        return 64
    acf = sys.argv[1]
    wid = sys.argv[2]

    text = open(acf, encoding='utf-8', errors='replace').read()
    orig_len = len(text)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    bak = acf + '.bak-unpin-' + stamp
    shutil.copy2(acf, bak)
    print('备份:', bak)

    text, ok1 = drop_block(text, 'WorkshopItemsInstalled', wid)
    text, ok2 = drop_block(text, 'WorkshopItemDetails', wid)
    print('WorkshopItemsInstalled 摘除:', ok1)
    print('WorkshopItemDetails 摘除:', ok2)

    if ok1 or ok2:
        open(acf, 'w', encoding='utf-8', newline='').write(text)
        print('写回完成，长度 %d -> %d' % (orig_len, len(text)))
    else:
        print('未做修改')

    opens = text.count('{')
    closes = text.count('}')
    print('花括号 open %d close %d %s' % (opens, closes, 'OK' if opens == closes else 'MISMATCH!'))
    print('剩余 item 数: %d' % len(re.findall(r'^\t\t"\d+"', text, re.M)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
