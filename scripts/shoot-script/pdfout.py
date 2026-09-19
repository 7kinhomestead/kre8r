#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdfout.py — print an HTML file to PDF with headless Edge.

The exact invocation that works on this machine, copied from
H:\\edit-staging\\routing-battleplan.py: a plain --headless silently fails, and
Edge can still be flushing the file when the process returns, so we wait for the
size to settle and then verify.
"""

import io
import os
import subprocess
import sys
import time

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def edge_path():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    raise RuntimeError('Microsoft Edge not found; looked in %s' % EDGE_CANDIDATES)


def write_html(path, html):
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    return path


def print_pdf(html_path, pdf_path, quiet=False):
    """True when a non-trivial PDF landed on disk."""
    profile = os.path.join(os.environ.get('TEMP', os.path.dirname(pdf_path)), 'edge-pdf-profile')
    d = os.path.dirname(os.path.abspath(pdf_path))
    if d and not os.path.isdir(d):
        os.makedirs(d)
    url = 'file:///' + os.path.abspath(html_path).replace('\\', '/')
    args = [edge_path(), '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
            '--user-data-dir=%s' % profile, '--virtual-time-budget=8000',
            '--print-to-pdf=%s' % pdf_path, url]
    subprocess.run(args, check=False)
    if not os.path.exists(pdf_path):
        sys.stderr.write('ERROR: Edge produced no PDF at %s\n' % pdf_path)
        return False
    last, stable = -1, 0
    for _ in range(40):
        sz = os.path.getsize(pdf_path)
        stable = stable + 1 if sz == last else 0
        if stable >= 2 and sz > 0:
            break
        last = sz
        time.sleep(0.25)
    os.utime(pdf_path, None)
    size = os.path.getsize(pdf_path)
    if size < 1200:
        sys.stderr.write('ERROR: %s is only %d bytes — Edge printed a blank.\n' % (pdf_path, size))
        return False
    if not quiet:
        print('  PDF  %s  (%.0f KB)' % (pdf_path, size / 1024.0))
    return True


def html_to_pdf(html, html_path, pdf_path, quiet=False):
    write_html(html_path, html)
    return print_pdf(html_path, pdf_path, quiet=quiet)
