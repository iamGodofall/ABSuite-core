"""Render DOSSIER.md to a professional PDF.

Hand-rolled rather than pandoc'd because the document is mostly tables and the
default markdown->PDF path renders them as unreadable blobs. Tables are the
substance here; they get real column widths.
"""
import re, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, HRFlowable)

SRC = sys.argv[1] if len(sys.argv) > 2 else 'docs/DOSSIER.md'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/ABSuite-Dossier.pdf'
INK   = colors.HexColor('#10101a')
MUTED = colors.HexColor('#5b6070')
RULE  = colors.HexColor('#d9dce5')
BAND  = colors.HexColor('#f2f4f9')
BRAND = colors.HexColor('#7C3AED')

ss = getSampleStyleSheet()
def st(name, **kw):
    base = dict(fontName='Helvetica', fontSize=9.5, leading=14, textColor=INK, alignment=TA_LEFT)
    base.update(kw); return ParagraphStyle(name, **base)

BODY  = st('body', spaceAfter=7)
H1    = st('h1', fontName='Helvetica-Bold', fontSize=19, leading=24, spaceBefore=20, spaceAfter=10, textColor=BRAND)
H2    = st('h2', fontName='Helvetica-Bold', fontSize=13.5, leading=18, spaceBefore=15, spaceAfter=7)
H3    = st('h3', fontName='Helvetica-Bold', fontSize=11, leading=15, spaceBefore=11, spaceAfter=5)
QUOTE = st('quote', fontSize=10.5, leading=16, leftIndent=12, textColor=BRAND, fontName='Helvetica-Oblique', spaceBefore=6, spaceAfter=8)
CELL  = st('cell', fontSize=8.2, leading=11)
CELLB = st('cellb', fontSize=8.2, leading=11, fontName='Helvetica-Bold')
CODE  = st('code', fontName='Courier', fontSize=8, leading=11, textColor=colors.HexColor('#233'), backColor=BAND, borderPadding=6, spaceBefore=5, spaceAfter=8)
LI    = st('li', spaceAfter=4, leftIndent=12, bulletIndent=3)

def inline(t):
    t = t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<font color="#7C3AED"><u>\1</u></font>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', t)
    t = re.sub(r'`([^`]+)`', r'<font face="Courier" size="8.5">\1</font>', t)
    return t

lines = open(SRC).read().split('\n')
flow, i = [], 0
while i < len(lines):
    ln = lines[i]

    if ln.startswith('```'):
        buf = []; i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            buf.append(lines[i].replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')); i += 1
        flow.append(Paragraph('<br/>'.join(buf) or ' ', CODE)); i += 1; continue

    if ln.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i+1]):
        rows = []
        head = [c.strip() for c in ln.strip('|').split('|')]
        rows.append([Paragraph(inline(c), CELLB) for c in head])
        i += 2
        while i < len(lines) and lines[i].startswith('|'):
            cells = [c.strip() for c in lines[i].strip('|').split('|')]
            cells += [''] * (len(head) - len(cells))
            rows.append([Paragraph(inline(c), CELL) for c in cells[:len(head)]])
            i += 1
        avail = 170*mm
        n = len(head)
        w = [avail*0.34] + [(avail*0.66)/(n-1)]*(n-1) if n > 1 else [avail]
        t = Table(rows, colWidths=w, repeatRows=1, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0), BAND),
            ('LINEBELOW',(0,0),(-1,0), 0.8, BRAND),
            ('GRID',(0,0),(-1,-1), 0.25, RULE),
            ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('TOPPADDING',(0,0),(-1,-1),4),
            ('BOTTOMPADDING',(0,0),(-1,-1),4),
            ('LEFTPADDING',(0,0),(-1,-1),5),
            ('RIGHTPADDING',(0,0),(-1,-1),5),
        ]))
        flow.append(t); flow.append(Spacer(1,9)); continue

    s = ln.strip()
    if s == '---':
        flow.append(Spacer(1,4)); flow.append(HRFlowable(width='100%', thickness=0.5, color=RULE)); flow.append(Spacer(1,6))
    elif s.startswith('# '):
        if len(flow) > 6: flow.append(PageBreak())
        flow.append(Paragraph(inline(s[2:]), H1))
    elif s.startswith('## '):  flow.append(Paragraph(inline(s[3:]), H2))
    elif s.startswith('### '): flow.append(Paragraph(inline(s[4:]), H3))
    elif s.startswith('> '):   flow.append(Paragraph(inline(s[2:]), QUOTE))
    elif re.match(r'^[-*] ', s): flow.append(Paragraph(inline(s[2:]), LI, bulletText='•'))
    elif re.match(r'^\d+\. ', s): flow.append(Paragraph(inline(re.sub(r'^\d+\. ','',s)), LI, bulletText='—'))
    elif s: flow.append(Paragraph(inline(s), BODY))
    i += 1

def furniture(c, d):
    c.saveState()
    c.setFont('Helvetica', 7); c.setFillColor(MUTED)
    c.drawString(20*mm, 12*mm, 'ABSuite — Complete Dossier · Enock Labs · 28 August 2026')
    c.drawRightString(190*mm, 12*mm, str(d.page))
    c.setStrokeColor(RULE); c.setLineWidth(0.4); c.line(20*mm, 15*mm, 190*mm, 15*mm)
    c.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=20*mm,
                        title='ABSuite — Complete Dossier', author='Enock Labs')
doc.build(flow, onFirstPage=furniture, onLaterPages=furniture)
print('wrote', OUT)
