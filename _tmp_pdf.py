# -*- coding: utf-8 -*-
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from pypdf import PdfReader
r = PdfReader(r"C:\Users\18054\.claude\projects\C--Users-18054-kre8r\a9af3263-5056-46e5-ac9d-2520e13ce463\tool-results\webfetch-1782020525117-7ht0fb.pdf")
for i,p in enumerate(r.pages):
    t = p.extract_text() or ""
    if "Fault" in t or "4K/5K" in t or "Fan is locked" in t or "Bus voltage" in t:
        print("=== PAGE", i, "===")
        print(t.encode("utf-8","replace").decode("utf-8"))
