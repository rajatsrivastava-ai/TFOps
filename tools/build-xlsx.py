# -*- coding: utf-8 -*-
"""Build the CEO workbook from a board export.

    node tools/export-board.mjs board.json
    python tools/build-xlsx.py board.json TFOps-CEO-Dashboard.xlsx

It is a *working* workbook, not a screenshot of one: the assumptions, the
effort weights and the what-if levers are real input cells, and every number
downstream of them is an Excel formula. Change the ceiling for editor leads
and the verdict on the front page rewrites itself.

Cached values are written alongside each formula so the file reads correctly
in viewers that do not recalculate on open.
"""

import json
import sys
from datetime import date, datetime

import xlsxwriter
from xlsxwriter.utility import xl_col_to_name as CL

RUPEE = "₹"
EM = "—"
TICK = "✓"
WARN = "▲"
DOT = "●"
PEN = "✎"

SRC = sys.argv[1] if len(sys.argv) > 1 else "board-export.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "TFOps-CEO-Dashboard.xlsx"

D = json.load(open(SRC, encoding="utf8"))
P = D["projects"]
SET = D["settings"]
T = D["totals"]
LT = D["loadTotals"]
CONC = D["concentration"]
CR = 1e7


def iso(s):
    return datetime.strptime(s, "%Y-%m-%d").date() if s else None


def serial(d):
    """Excel's day number. write_formula() takes a cached value, not a date."""
    return (d - date(1899, 12, 30)).days if d else ""


TODAY = iso(D["today"])

# ---------------------------------------------------------------- palette
# Straight from public/app.css, so the workbook and the board look related.
INK, INK2, INK3 = "#010101", "#595959", "#8A8A8A"
SURFACE, SURF2, LINE = "#FFFFFF", "#F1F1F1", "#E4E4E7"
ACCENT, ACCENT_INK, ACCENT_WASH = "#6258E9", "#5242D2", "#EEECFD"
S1, S2, S3, S4 = "#6258E9", "#EB6834", "#1BAF7A", "#EDA100"
S5, S6, S7, S8 = "#E87BA4", "#008300", "#2A78D6", "#E34948"
GOOD_WASH, WARN_WASH, CRIT_WASH = "#E7F6E7", "#FDF3DC", "#FAE9E9"
GOOD_INK, WARN_INK, CRIT_INK = "#0A7D0A", "#8A6000", "#B42F2F"

Q = '"'
MONEY = ("[>=10000000]" + Q + RUPEE + Q + "##\\,##\\,##\\,##0;"
         "[>=100000]" + Q + RUPEE + Q + "##\\,##\\,##0;"
         + Q + RUPEE + Q + "##,##0")
CRFMT = '0.00" Cr"'
PCT1 = '0.0"%"'

wb = xlsxwriter.Workbook(OUT, {"default_date_format": "dd mmm yyyy",
                               "nan_inf_to_errors": True})
wb.set_properties({
    "title": "TFOps " + EM + " delivery and revenue",
    "subject": "TrueFan operations board, as of " + D["today"],
    "author": "TFOps",
    "company": SET.get("orgName", "TrueFan"),
    "comments": "Generated from data/store.json by tools/build-xlsx.py. "
                "Shaded cells are inputs; everything else is a formula.",
})
wb.set_calc_mode("auto")

BASE = {"font_name": "Aptos Narrow", "font_size": 10, "valign": "vcenter"}


def F(**kw):
    d = dict(BASE)
    d.update(kw)
    return wb.add_format(d)


f = {
    "title": F(font_size=20, bold=True),
    "sub": F(font_size=10, font_color=INK2),
    "h1": F(font_size=15, bold=True),
    "h2": F(font_size=11, bold=True),
    "eyebrow": F(font_size=8, bold=True, font_color=INK3),
    "note": F(font_size=9, font_color=INK2, text_wrap=True, valign="top"),
    "notesm": F(font_size=8, font_color=INK3, italic=True),
    "body": F(text_wrap=True, valign="top"),
    "th": F(bold=True, font_size=9, bg_color=SURF2, bottom=1, border_color=LINE,
            text_wrap=True, valign="bottom"),
    "thr": F(bold=True, font_size=9, bg_color=SURF2, bottom=1, border_color=LINE,
             text_wrap=True, valign="bottom", align="right"),
    "cell": F(bottom=1, border_color=LINE),
    "cellw": F(bottom=1, border_color=LINE, text_wrap=True, valign="top"),
    "num": F(bottom=1, border_color=LINE, align="right", num_format="#,##0"),
    "num1": F(bottom=1, border_color=LINE, align="right", num_format="#,##0.0"),
    "num2": F(bottom=1, border_color=LINE, align="right", num_format="#,##0.00"),
    "money": F(bottom=1, border_color=LINE, align="right", num_format=MONEY),
    "cr": F(bottom=1, border_color=LINE, align="right", num_format=CRFMT),
    "pct": F(bottom=1, border_color=LINE, align="right", num_format=PCT1),
    "date": F(bottom=1, border_color=LINE, align="right", num_format="dd mmm yy"),
    "mute": F(bottom=1, border_color=LINE, font_color=INK3, font_size=9),
    "key": F(bottom=1, border_color=LINE, font_color=INK3, font_size=8),
    "bold": F(bottom=1, border_color=LINE, bold=True),
    "input": F(bg_color="#FFF8E1", border=1, border_color="#D9BE6A", align="right",
               num_format="General", locked=False),
    "inputpct": F(bg_color="#FFF8E1", border=1, border_color="#D9BE6A", align="right",
                  num_format='0"%"', locked=False),
    "inputtxt": F(bg_color="#FFF8E1", border=1, border_color="#D9BE6A", locked=False),
    "inputdate": F(bg_color="#FFF8E1", border=1, border_color="#D9BE6A", align="right",
                   num_format="dd mmm yyyy", locked=False),
    "kpi_k": F(font_size=8, bold=True, font_color=INK3, bg_color=SURFACE,
               left=1, right=1, top=1, border_color=LINE, valign="top", indent=1),
    "kpi_v": F(font_size=20, bold=True, bg_color=SURFACE, left=1, right=1,
               border_color=LINE, valign="vcenter", indent=1),
    "kpi_va": F(font_size=20, bold=True, font_color=ACCENT_INK, bg_color=SURFACE,
                left=1, right=1, border_color=LINE, valign="vcenter", indent=1),
    "kpi_n": F(font_size=8, font_color=INK2, bg_color=SURFACE, left=1, right=1,
               bottom=1, border_color=LINE, valign="top", indent=1, text_wrap=True),
    "vhot": F(font_size=12, bold=True, font_color=CRIT_INK, bg_color=CRIT_WASH,
              border=1, border_color="#EFCBCB", text_wrap=True, valign="vcenter", indent=1),
    "vok": F(font_size=12, bold=True, font_color=GOOD_INK, bg_color=GOOD_WASH,
             border=1, border_color="#C9E5C9", text_wrap=True, valign="vcenter", indent=1),
    "band": F(bg_color=ACCENT, font_color="#FFFFFF", bold=True, font_size=10, indent=1),
    "wash": F(bg_color=ACCENT_WASH, font_color=ACCENT_INK, bold=True, font_size=9, indent=1),
    "good": F(bottom=1, border_color=LINE, font_color=GOOD_INK, bg_color=GOOD_WASH, font_size=9),
    "warn": F(bottom=1, border_color=LINE, font_color=WARN_INK, bg_color=WARN_WASH, font_size=9),
    "crit": F(bottom=1, border_color=LINE, font_color=CRIT_INK, bg_color=CRIT_WASH, font_size=9),
    "total": F(top=2, border_color=INK, bold=True, bg_color=SURF2),
    "totaln": F(top=2, border_color=INK, bold=True, bg_color=SURF2, align="right",
                num_format="#,##0.0"),
    "totalcr": F(top=2, border_color=INK, bold=True, bg_color=SURF2, align="right",
                 num_format=CRFMT),
    "totalmoney": F(top=2, border_color=INK, bold=True, bg_color=SURF2, align="right",
                    num_format=MONEY),
    "totalpct": F(top=2, border_color=INK, bold=True, bg_color=SURF2, align="right",
                  num_format=PCT1),
}


def sheet(name, tab=ACCENT, title=None, sub=None, freeze=None, zoom=100):
    """Dress a sheet. The sheets themselves are created up front, in tab order."""
    ws = WS[name]
    ws.set_tab_color(tab)
    ws.hide_gridlines(2)
    ws.set_zoom(zoom)
    ws.set_paper(9)
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.repeat_rows(0, 2)
    if title:
        ws.write(0, 0, title, f["h1"])
        ws.set_row(0, 24)
    if sub:
        ws.write(1, 0, sub, f["sub"])
        ws.set_row(1, 13)
    if freeze:
        ws.freeze_panes(*freeze)
    return ws


class Table:
    """Header row plus column bookkeeping, so formulas never guess a letter."""

    def __init__(self, ws, row, cols, n=0):
        self.ws, self.hrow, self.n = ws, row, n
        self.idx = {c[0]: i for i, c in enumerate(cols)}
        self.first = row + 2          # 1-based row of the first data row
        self.last = row + 1 + max(n, 1)
        for i, c in enumerate(cols):
            ws.set_column(i, i, c[1])
            ws.write(row, i, c[0], f["thr"] if len(c) > 2 and c[2] == "r" else f["th"])
        ws.set_row(row, 26)

    def i(self, n):
        return self.idx[n]

    def L(self, n):
        return CL(self.idx[n])

    def rng(self, n):
        return "$%s$%d:$%s$%d" % (self.L(n), self.first, self.L(n), self.last)

    def c(self, n, r):
        return "$%s%d" % (self.L(n), r)


def ref(ws, a1):
    """Sheet-qualified absolute reference."""
    nm = ws.get_name()
    if any(ch in nm for ch in " -&"):
        nm = "'" + nm + "'"
    return nm + "!" + a1


# Tab order is the reading order: the answer, then the levers, then the
# evidence, then the machinery.
TABS = [
    "Dashboard", "Scenario", "Clients", "People", "Escalations", "Projects",
    "Timeline", "Pods", "Service lines", "Revenue", "Updates",
    "Assumptions", "Allocations", "How to read this",
]
WS = {name: wb.add_worksheet(name) for name in TABS}


# ====================================================================== 1. assumptions
asm = sheet("Assumptions", tab=INK3,
            title="Assumptions",
            sub="Every shaded cell is an input. Change one and the whole workbook "
                "re-reads " + EM + " these are the same knobs as the board's "
                "Assumptions block.")
asm.set_column(0, 0, 34)
asm.set_column(1, 1, 16)
asm.set_column(2, 2, 62)

r = 3
asm.write(r, 0, "THE TEAM AND WHAT IT COSTS", f["eyebrow"])
r += 1
rows = [
    ("As of", "AsOf", TODAY, "inputdate",
     "The date every 'days since' number counts back from."),
    ("Live projects one DM can hold", "CapDM", SET["capacityPerDM"], "input",
     "The ceiling. Above this, a DM is over."),
    ("Live projects one editor lead can hold", "CapEd", SET["capacityPerEditor"], "input",
     "The ceiling for editor leads."),
    ("Fully loaded cost of a DM (per year)", "CostDM", SET["costPerDM"], "input",
     "Used only by the Scenario tab, to price a hire."),
    ("Fully loaded cost of an editor lead", "CostEd", SET["costPerEditor"], "input",
     "Same."),
    ("Revenue target (" + RUPEE + " Cr)", "TargetCr", SET["targetRevenueCr"], "input",
     "The number the book is measured against."),
    ("An update is stale after (days)", "StaleDays", SET["staleUpdateDays"], "input",
     "Past this, a live project is flagged on Escalations."),
    ("Effort when no service line is set", "DefaultEffort", D["effortDefault"], "input",
     "The fallback weight for a row with no service line."),
]
for label, name, val, fmt, note in rows:
    asm.write(r, 0, label, f["cell"])
    if fmt == "inputdate":
        asm.write_datetime(r, 1, val, f["inputdate"])
    else:
        asm.write_number(r, 1, val, f[fmt])
    if name == "CostDM" or name == "CostEd":
        asm.write_number(r, 1, val, F(bg_color="#FFF8E1", border=1, border_color="#D9BE6A",
                                      align="right", num_format=MONEY, locked=False))
    asm.write(r, 2, note, f["note"])
    wb.define_name(name, "=" + ref(asm, "$B$%d" % (r + 1)))
    r += 1

r += 2
asm.write(r, 0, "WHAT A JOB COSTS THE TEAM", f["eyebrow"])
asm.write(r, 2, "Effort points per project, by service line. The heaviest line on a "
                "row wins; a scope naming a four-figure volume adds one, capped at 5.",
          f["note"])
r += 1
asm.write(r, 0, "Service line", f["th"])
asm.write(r, 1, "Effort points", f["thr"])
r += 1
ew_first = r + 1
for k, v in sorted(D["effortWeights"].items(), key=lambda x: -x[1]):
    asm.write(r, 0, k, f["cell"])
    asm.write_number(r, 1, v, f["input"])
    asm.write(r, 2, D["effortLabels"][str(v)], f["mute"])
    r += 1
wb.define_name("EffortWeights", "=" + ref(asm, "$A$%d:$B$%d" % (ew_first, r)))

r += 2
asm.write(r, 0, "WHAT A STATUS IS WORTH", f["eyebrow"])
asm.write(r, 2, "Parked work still occupies a slot in someone's head, but not a "
                "full one. Upcoming work counts half, on-hold a quarter.", f["note"])
r += 1
asm.write(r, 0, "Status", f["th"])
asm.write(r, 1, "Multiplier", f["thr"])
r += 1
sw_first = r + 1
for k, v in [("active", 1), ("upcoming", 0.5), ("hold", 0.25), ("done", 0)]:
    asm.write(r, 0, k, f["cell"])
    asm.write_number(r, 1, v, f["input"])
    r += 1
wb.define_name("StatusWeights", "=" + ref(asm, "$A$%d:$B$%d" % (sw_first, r)))

r += 2
asm.write(r, 0, "Source", f["eyebrow"])
asm.write(r, 1, "Board data saved " + D["updatedAt"][:16].replace("T", " ") + " UTC"
          + ".  Workbook built " + D["generatedAt"][:16].replace("T", " ") + " UTC.",
          f["sub"])

AS_OF = "AsOf"


# ====================================================================== 2. revenue
rev = sheet("Revenue", tab=S3,
            title="The book of business",
            sub="One line per client, as the revenue sheet books it. A client can "
                "carry several project rows on the board; the split across them "
                "happens on Projects, not here.",
            freeze=(3, 1))
RV = Table(rev, 2, [
    ("Client", 30), ("Client key", 16), ("Revenue", 15, "r"), (RUPEE + " Cr", 10, "r"),
    ("Share of book", 11, "r"), ("Revenue mapped", 13), ("Project rows on the board", 11, "r"),
    ("Per project row", 14, "r"),
], n=len(D["revenue"]))
rev.set_column(RV.i("Client key"), RV.i("Client key"), 16, f["key"])

rev_total = sum(x["amount"] for x in D["revenue"])
for i, x in enumerate(sorted(D["revenue"], key=lambda z: -z["amount"])):
    r = RV.first + i
    rr = r - 1
    rev.write(rr, RV.i("Client"), x["client"], f["cell"])
    rev.write(rr, RV.i("Client key"), x["key"], f["key"])
    rev.write_number(rr, RV.i("Revenue"), x["amount"], f["money"])
    rev.write_formula(rr, RV.i(RUPEE + " Cr"), "=%s/10000000" % RV.c("Revenue", r),
                      f["cr"], x["amount"] / CR)
    rev.write_formula(rr, RV.i("Share of book"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (RV.c("Revenue", r), RV.rng("Revenue")),
                      f["pct"], x["amount"] / rev_total * 100 if rev_total else 0)
    rev.write(rr, RV.i("Revenue mapped"), "not mapped" if x["unmapped"] else "yes",
              f["warn"] if x["unmapped"] else f["mute"])
    rev.write_formula(rr, RV.i("Project rows on the board"),
                      "=COUNTIF(%s,%s)" % (ref(WS["Projects"], "$B:$B"), RV.c("Client key", r)),
                      f["num"], 0)
    rev.write_formula(rr, RV.i("Per project row"),
                      "=IFERROR(%s/%s,%s)" % (RV.c("Revenue", r),
                                              RV.c("Project rows on the board", r),
                                              '"' + EM + '"'),
                      f["money"], 0)

tr = RV.last
rev.write(tr, 0, "Total book", f["total"])
rev.write(tr, 1, "", f["total"])
rev.write_formula(tr, RV.i("Revenue"), "=SUM(%s)" % RV.rng("Revenue"),
                  f["totalmoney"], rev_total)
rev.write_formula(tr, RV.i(RUPEE + " Cr"), "=SUM(%s)" % RV.rng(RUPEE + " Cr"),
                  f["totalcr"], rev_total / CR)
for cn in ("Share of book", "Revenue mapped", "Project rows on the board", "Per project row"):
    rev.write(tr, RV.i(cn), "", f["total"])
rev.autofilter(RV.hrow, 0, RV.last - 1, len(RV.idx) - 1)
rev.conditional_format(RV.first - 1, RV.i("Revenue"), RV.last - 1, RV.i("Revenue"),
                       {"type": "data_bar", "bar_color": S3, "bar_solid": True,
                        "bar_only": False})
rev.merge_range(
    RV.last + 2, 0, RV.last + 3, 7,
    "Clients marked 'not mapped' are billed somewhere the source sheet never tied to a "
    "client key. The board shows them as " + PEN + " rather than " + RUPEE + "0, because "
    "zero reads as free work when it is really a gap in the data.", f["note"])


# ====================================================================== 3. projects
prj = sheet("Projects", tab=INK3,
            title="Every project row on the board",
            sub="The sheet, with the board's arithmetic attached. Effort points, "
                "attributed revenue and the two time-based flags are live formulas "
                "off Assumptions; the written risks were evaluated at export.",
            freeze=(3, 3), zoom=90)
PJ = Table(prj, 2, [
    ("Client", 22), ("Client key", 15), ("Project", 26), ("Status", 10), ("Kind", 9),
    ("Priority", 9), ("Pod owner", 16), ("SDM", 11),
    ("DM 1", 16), ("DM 2", 15), ("DMs", 6, "r"),
    ("Editor lead 1", 16), ("Editor lead 2", 15), ("Editor leads", 7, "r"),
    ("Service lines", 26), ("Lines", 6, "r"), ("Heaviest line", 16), ("Bulk scope", 7, "r"),
    ("Effort (set)", 9, "r"), ("Effort base", 9, "r"), ("Status weight", 8, "r"),
    ("Effort points", 9, "r"), ("Basis", 9),
    ("Revenue attributed", 14, "r"), ("Revenue mapped", 11),
    ("Start", 11, "r"), ("End", 11, "r"), ("Open-ended", 9), ("Days overdue", 9, "r"),
    ("Last update", 11, "r"), ("Days since update", 9, "r"), ("Update state", 12),
    ("Updates 60d", 8, "r"),
    ("Risks", 7, "r"), ("Serious", 7, "r"), ("Risk score", 8, "r"),
    ("Escalation score", 9, "r"),
    ("What is wrong", 48), ("Open blocker", 34), ("Scope", 44), ("Sheet row", 8, "r"),
], n=len(P))

PJKEY = ref(prj, PJ.rng("Client key"))
RVKEY = ref(rev, RV.rng("Client key"))
RVAMT = ref(rev, RV.rng("Revenue"))
RVMAP = ref(rev, RV.rng("Revenue mapped"))

for i, p in enumerate(sorted(P, key=lambda z: (z["client"].lower(), z["projectName"] or ""))):
    r = PJ.first + i
    rr = r - 1
    w = lambda cn, v, fmt="cell": prj.write(rr, PJ.i(cn), v, f[fmt])
    wf = lambda cn, fo, val, fmt="cell": prj.write_formula(rr, PJ.i(cn), fo, f[fmt], val)

    w("Client", p["client"])
    w("Client key", p["clientKey"], "key")
    w("Project", p["projectName"] or EM)
    w("Status", p["status"])
    wf("Kind",
       '=IF(ISNUMBER(SEARCH("hold",{s})),"hold",'
       'IF(OR(ISNUMBER(SEARCH("upcoming",{s})),ISNUMBER(SEARCH("pipeline",{s}))),"upcoming",'
       'IF(OR(ISNUMBER(SEARCH("complet",{s})),ISNUMBER(SEARCH("done",{s})),'
       'ISNUMBER(SEARCH("closed",{s}))),"done","active")))'.format(s=PJ.c("Status", r)),
       p["statusKind"], "mute")
    w("Priority", p["priority"] or EM, "mute")
    w("Pod owner", p["podOwner"] or "(unassigned)")
    w("SDM", p["sdm"] or EM, "mute")
    dms = p["dms"] + ["", ""]
    eds = p["editorLeads"] + ["", ""]
    w("DM 1", dms[0])
    w("DM 2", dms[1])
    wf("DMs", "=COUNTA(%s:%s)" % (PJ.c("DM 1", r), PJ.c("DM 2", r)), len(p["dms"]), "num")
    w("Editor lead 1", eds[0])
    w("Editor lead 2", eds[1])
    wf("Editor leads", "=COUNTA(%s:%s)" % (PJ.c("Editor lead 1", r), PJ.c("Editor lead 2", r)),
       len(p["editorLeads"]), "num")
    w("Service lines", ", ".join(p["categories"]) or EM, "mute")
    w("Lines", len(p["categories"]), "num")
    w("Heaviest line", p["weightFrom"] or EM, "mute")
    w("Bulk scope", p["bulk"], "num")
    prj.write_blank(rr, PJ.i("Effort (set)"), None, f["input"])
    wf("Effort base",
       "=IF(N({st})>0,{st},MIN(5,IFERROR(VLOOKUP({hl},EffortWeights,2,FALSE),DefaultEffort)+{bk}))"
       .format(st=PJ.c("Effort (set)", r), hl=PJ.c("Heaviest line", r), bk=PJ.c("Bulk scope", r)),
       p["effortBase"], "num")
    wf("Status weight", "=IFERROR(VLOOKUP(%s,StatusWeights,2,FALSE),1)" % PJ.c("Kind", r),
       D["statusWeights"][p["statusKind"]], "num2")
    wf("Effort points", "=%s*%s" % (PJ.c("Effort base", r), PJ.c("Status weight", r)),
       p["effortPoints"], "num2")
    wf("Basis", '=IF(N(%s)>0,"set","assumed")' % PJ.c("Effort (set)", r),
       p["effortSource"], "mute")
    wf("Revenue attributed",
       "=IFERROR(SUMIF({rk},{k},{ra})/COUNTIF({pk},{k}),0)"
       .format(rk=RVKEY, ra=RVAMT, pk=PJKEY, k=PJ.c("Client key", r)),
       p["rev"], "money")
    wf("Revenue mapped",
       '=IF(COUNTIF({rk},{k})=0,"no revenue row",'
       'IF(COUNTIFS({rk},{k},{rm},"not mapped")>0,"not mapped","yes"))'
       .format(rk=RVKEY, rm=RVMAP, k=PJ.c("Client key", r)),
       "not mapped" if p["unmapped"] else "yes", "mute")
    if p["start"]:
        prj.write_datetime(rr, PJ.i("Start"), iso(p["start"]), f["date"])
    else:
        prj.write(rr, PJ.i("Start"), (PEN + " " + p["startNote"]) if p["startNote"] else EM, f["mute"])
    if p["end"]:
        prj.write_datetime(rr, PJ.i("End"), iso(p["end"]), f["date"])
    else:
        prj.write(rr, PJ.i("End"), (PEN + " " + p["endNote"]) if p["endNote"] else EM, f["mute"])
    w("Open-ended", "open" if p["openEnded"] else ("TBD" if p["datesUnknown"] else ""), "mute")
    wf("Days overdue",
       '=IF(AND(ISNUMBER({e}),{k}<>"done",{o}<>"open",AsOf>{e}),AsOf-{e},"")'
       .format(e=PJ.c("End", r), k=PJ.c("Kind", r), o=PJ.c("Open-ended", r)),
       p["overdueDays"] if p["overdueDays"] else "", "num")
    lu = p["lastUpdate"]
    if lu:
        prj.write_datetime(rr, PJ.i("Last update"), iso(lu["date"]), f["date"])
    else:
        prj.write(rr, PJ.i("Last update"), "", f["date"])
    wf("Days since update",
       '=IF(ISNUMBER({l}),AsOf-{l},"")'.format(l=PJ.c("Last update", r)),
       p["staleDays"] if p["staleDays"] is not None else "", "num")
    wf("Update state",
       '=IF({k}<>"active","",IF(NOT(ISNUMBER({l})),"never updated",'
       'IF(AsOf-{l}>StaleDays*2,"very stale",IF(AsOf-{l}>StaleDays,"stale","current"))))'
       .format(k=PJ.c("Kind", r), l=PJ.c("Last update", r)),
       "", "cell")
    w("Updates 60d", p["activity60"], "num")
    w("Risks", len(p["risks"]), "num")
    w("Serious", sum(1 for x in p["risks"] if x["sev"] == 2), "num")
    w("Risk score", p["riskScore"], "num")
    w("Escalation score", round(p["escalation"], 1), "num1")
    w("What is wrong",
      (" " + DOT + " ").join(x["label"] for x in p["risks"]) or "nothing flagged", "cellw")
    w("Open blocker", p["blocker"] or "", "cellw")
    w("Scope", p["scope"] or "", "cellw")
    w("Sheet row", p["sourceRow"], "num")

tr = PJ.last
prj.write(tr, 0, "%d projects" % len(P), f["total"])
for c in range(1, len(PJ.idx)):
    prj.write_blank(tr, c, None, f["total"])
prj.write_formula(tr, PJ.i("Effort points"), "=SUM(%s)" % PJ.rng("Effort points"),
                  f["totaln"], LT["totalPoints"])
prj.write_formula(tr, PJ.i("Revenue attributed"), "=SUM(%s)" % PJ.rng("Revenue attributed"),
                  f["totalmoney"], T["rev"])
prj.write_formula(tr, PJ.i("Updates 60d"), "=SUM(%s)" % PJ.rng("Updates 60d"),
                  f["totaln"], sum(p["activity60"] for p in P))

prj.autofilter(PJ.hrow, 0, PJ.last - 1, len(PJ.idx) - 1)
lo, hi = PJ.first - 1, PJ.last - 1
prj.conditional_format(lo, PJ.i("Effort points"), hi, PJ.i("Effort points"),
                       {"type": "data_bar", "bar_color": ACCENT, "bar_solid": True})
prj.conditional_format(lo, PJ.i("Revenue attributed"), hi, PJ.i("Revenue attributed"),
                       {"type": "data_bar", "bar_color": S3, "bar_solid": True})
prj.conditional_format(lo, PJ.i("Days overdue"), hi, PJ.i("Days overdue"),
                       {"type": "cell", "criteria": ">", "value": 0, "format": f["crit"]})
for word, fmt in (("very stale", f["crit"]), ("never updated", f["crit"]),
                  ("stale", f["warn"]), ("current", f["good"])):
    prj.conditional_format(lo, PJ.i("Update state"), hi, PJ.i("Update state"),
                           {"type": "text", "criteria": "containing", "value": word,
                            "format": fmt, "stop_if_true": True})
prj.conditional_format(lo, PJ.i("Revenue mapped"), hi, PJ.i("Revenue mapped"),
                       {"type": "text", "criteria": "containing", "value": "not mapped",
                        "format": f["warn"]})
prj.conditional_format(lo, PJ.i("Serious"), hi, PJ.i("Serious"),
                       {"type": "cell", "criteria": ">", "value": 0, "format": f["crit"]})
prj.data_validation(lo, PJ.i("Effort (set)"), hi, PJ.i("Effort (set)"),
                    {"validate": "integer", "criteria": "between", "minimum": 1, "maximum": 5,
                     "input_title": "Delivery effort",
                     "input_message": "1 Light, 2 Standard, 3 Heavy, 4 Very heavy, 5 Flagship.\n"
                                      "Leave blank to keep the assumed weight."})


# ====================================================================== 4. allocations
alc = sheet("Allocations", tab=INK3,
            title="Who is on what " + EM + " one row per person, per project",
            sub="The support table the People, Clients and Pods tabs add up. A "
                "project with two DMs weighs half as much on each, which is why "
                "these shares are fractional.",
            freeze=(3, 1), zoom=90)
AL = Table(alc, 2, [
    ("Person", 20), ("Role", 12), ("Client", 22), ("Client key", 15), ("Project", 26),
    ("Label", 32),
    ("Pod owner", 16), ("Status kind", 10), ("People in this role", 8, "r"),
    ("Effort points", 10, "r"), ("Revenue attributed", 14, "r"), ("Updates 60d", 9, "r"),
    ("Projects row", 9, "r"),
], n=sum(len(p["dms"]) + len(p["editorLeads"]) for p in P))

prow = {}
for i, p in enumerate(sorted(P, key=lambda z: (z["client"].lower(), z["projectName"] or ""))):
    prow[p["id"]] = PJ.first + i

ai = 0
alloc_rows = []
for p in P:
    r = prow[p["id"]]
    for role, field, cnt in (("DM", "dms", "DMs"), ("Editor lead", "editorLeads", "Editor leads")):
        for name in p[field]:
            alloc_rows.append((name, role, p, r, cnt, len(p[field])))
alloc_rows.sort(key=lambda x: (x[1], x[0].lower(), x[2]["client"].lower()))

for name, role, p, r, cnt, n in alloc_rows:
    ar = AL.first + ai
    rr = ar - 1
    ai += 1
    pj = lambda cn: ref(prj, PJ.c(cn, r))
    alc.write(rr, AL.i("Person"), name, f["cell"])
    alc.write(rr, AL.i("Role"), role, f["mute"])
    alc.write_formula(rr, AL.i("Client"), "=" + pj("Client"), f["cell"], p["client"])
    alc.write_formula(rr, AL.i("Client key"), "=" + pj("Client key"), f["key"], p["clientKey"])
    alc.write_formula(rr, AL.i("Project"), "=" + pj("Project"), f["cell"], p["projectName"] or EM)
    alc.write_formula(rr, AL.i("Label"),
                      '=%s&" %s "&%s' % (pj("Client"), EM, pj("Project")), f["mute"], p["label"])
    alc.write_formula(rr, AL.i("Pod owner"), "=" + pj("Pod owner"), f["mute"], p["podOwner"] or EM)
    alc.write_formula(rr, AL.i("Status kind"), "=" + pj("Kind"), f["mute"], p["statusKind"])
    alc.write_formula(rr, AL.i("People in this role"), "=MAX(1," + pj(cnt) + ")", f["num"], n)
    alc.write_formula(rr, AL.i("Effort points"),
                      "=%s/%s" % (pj("Effort points"), AL.c("People in this role", ar)),
                      f["num2"], p["effortPoints"] / max(1, n))
    alc.write_formula(rr, AL.i("Revenue attributed"),
                      "=%s/%s" % (pj("Revenue attributed"), AL.c("People in this role", ar)),
                      f["money"], p["rev"] / max(1, n))
    alc.write_formula(rr, AL.i("Updates 60d"),
                      "=%s/%s" % (pj("Updates 60d"), AL.c("People in this role", ar)),
                      f["num1"], p["activity60"] / max(1, n))
    alc.write_number(rr, AL.i("Projects row"), r, f["key"])

alc.autofilter(AL.hrow, 0, AL.last - 1, len(AL.idx) - 1)
ALPER, ALROLE = ref(alc, AL.rng("Person")), ref(alc, AL.rng("Role"))
ALKIND, ALPTS = ref(alc, AL.rng("Status kind")), ref(alc, AL.rng("Effort points"))
ALREV, ALACT = ref(alc, AL.rng("Revenue attributed")), ref(alc, AL.rng("Updates 60d"))
ALCKEY, ALPOD = ref(alc, AL.rng("Client key")), ref(alc, AL.rng("Pod owner"))
ALLABEL = ref(alc, AL.rng("Label"))


# handy absolute ranges into Projects
PJKIND = ref(prj, PJ.rng("Kind"))
PJPTS = ref(prj, PJ.rng("Effort points"))
PJREV = ref(prj, PJ.rng("Revenue attributed"))
PJPOD = ref(prj, PJ.rng("Pod owner"))
PJLINES = ref(prj, PJ.rng("Service lines"))
PJNLINES = ref(prj, PJ.rng("Lines"))
PJRISK = ref(prj, PJ.rng("Risk score"))
PJACT = ref(prj, PJ.rng("Updates 60d"))


def distinct(target, conds):
    """Live distinct count of `target` over rows matching every (range, criteria)."""
    mask = "*".join("(%s=%s)" % (rg, cr) for rg, cr in conds)
    args = ",".join("%s,%s" % (rg, cr) for rg, cr in conds)
    return "=SUMPRODUCT(({m})/(COUNTIFS({t},{t},{a})+1-({m})))".format(m=mask, t=target, a=args)


# ====================================================================== 5. people
people = []
for p in D["edLoad"]:
    people.append(("Editor lead", p))
for p in D["dmLoad"]:
    people.append(("DM", p))

ppl = sheet("People", tab=S2,
            title="Who is carrying what",
            sub="Editor leads first, because they are the narrower role. A project "
                "shared by two people weighs half on each, so these counts are "
                "fractional where the work is shared.",
            freeze=(3, 2))
PP = Table(ppl, 2, [
    ("Person", 20), ("Role", 12), ("Projects", 8, "r"), ("Live", 7, "r"),
    ("On hold", 8, "r"), ("Upcoming", 8, "r"), ("Effort points", 10, "r"),
    ("Share of role's time", 11, "r"), ("Ceiling", 8, "r"), ("Utilisation", 10, "r"),
    ("Verdict", 14), ("Clients", 8, "r"), ("Revenue attributed", 14, "r"),
    (RUPEE + " Cr", 9, "r"), ("Updates 60d", 9, "r"), ("Heaviest project", 32),
], n=len(people))

for i, (role, pr) in enumerate(people):
    r = PP.first + i
    rr = r - 1
    nm = PP.c("Person", r)
    rl = PP.c("Role", r)
    base = "{p},{n},{r},{l}".format(p=ALPER, n=nm, r=ALROLE, l=rl)
    ppl.write(rr, PP.i("Person"), pr["name"], f["bold"])
    ppl.write(rr, PP.i("Role"), role, f["mute"])
    ppl.write_formula(rr, PP.i("Projects"), "=COUNTIFS(%s)" % base, f["num"], pr["projects"])
    for cn, kind, val in (("Live", "active", pr["live"]), ("On hold", "hold", pr["held"]),
                          ("Upcoming", "upcoming", pr["upcoming"])):
        ppl.write_formula(rr, PP.i(cn), '=COUNTIFS(%s,%s,"%s")' % (base, ALKIND, kind),
                          f["num"], val)
    ppl.write_formula(rr, PP.i("Effort points"), "=SUMIFS(%s,%s)" % (ALPTS, base),
                      f["num2"], pr["points"])
    ppl.write_formula(rr, PP.i("Share of role's time"),
                      "=IFERROR(%s/SUMIFS(%s,%s,%s)*100,0)"
                      % (PP.c("Effort points", r), ALPTS, ALROLE, rl),
                      f["pct"], pr["points"] / (LT["dmPoints"] if role == "DM" else LT["edPoints"]) * 100)
    ppl.write_formula(rr, PP.i("Ceiling"), '=IF(%s="DM",CapDM,CapEd)' % rl, f["num"],
                      SET["capacityPerDM"] if role == "DM" else SET["capacityPerEditor"])
    ppl.write_formula(rr, PP.i("Utilisation"),
                      "=IFERROR(%s/%s*100,0)" % (PP.c("Live", r), PP.c("Ceiling", r)),
                      f["pct"], pr["live"] / (SET["capacityPerDM"] if role == "DM" else SET["capacityPerEditor"]) * 100)
    ppl.write_formula(rr, PP.i("Verdict"),
                      '=IF({u}>100,"over the ceiling",IF({u}>85,"at the limit","has room"))'
                      .format(u=PP.c("Utilisation", r)), f["cell"], "")
    ppl.write_formula(rr, PP.i("Clients"), distinct(ALCKEY, [(ALPER, nm), (ALROLE, rl)]),
                      f["num"], pr["clients"])
    ppl.write_formula(rr, PP.i("Revenue attributed"), "=SUMIFS(%s,%s)" % (ALREV, base),
                      f["money"], pr["rev"])
    ppl.write_formula(rr, PP.i(RUPEE + " Cr"), "=%s/10000000" % PP.c("Revenue attributed", r),
                      f["cr"], pr["rev"] / CR)
    ppl.write_formula(rr, PP.i("Updates 60d"), "=SUMIFS(%s,%s)" % (ALACT, base),
                      f["num1"], pr["activity"])
    ppl.write(rr, PP.i("Heaviest project"),
              pr["top"]["label"] if pr["top"] else "", f["mute"])

tr = PP.last
ppl.write(tr, 0, "%d people" % len(people), f["total"])
for c in range(1, len(PP.idx)):
    ppl.write_blank(tr, c, None, f["total"])
ppl.write_formula(tr, PP.i("Effort points"), "=SUM(%s)/2" % PP.rng("Effort points"),
                  f["totaln"], LT["totalPoints"])
ppl.write(tr, PP.i("Verdict"), "points counted once per role", f["totaln"])
lo, hi = PP.first - 1, PP.last - 1
ppl.conditional_format(lo, PP.i("Effort points"), hi, PP.i("Effort points"),
                       {"type": "data_bar", "bar_color": ACCENT, "bar_solid": True})
ppl.conditional_format(lo, PP.i("Utilisation"), hi, PP.i("Utilisation"),
                       {"type": "cell", "criteria": ">", "value": 100, "format": f["crit"]})
ppl.conditional_format(lo, PP.i("Utilisation"), hi, PP.i("Utilisation"),
                       {"type": "cell", "criteria": "between", "minimum": 85, "maximum": 100,
                        "format": f["warn"]})
for word, fmt in (("over the ceiling", f["crit"]), ("at the limit", f["warn"]),
                  ("has room", f["good"])):
    ppl.conditional_format(lo, PP.i("Verdict"), hi, PP.i("Verdict"),
                           {"type": "text", "criteria": "containing", "value": word,
                            "format": fmt, "stop_if_true": True})
ppl.autofilter(PP.hrow, 0, PP.last - 1, len(PP.idx) - 1)
ppl.merge_range(PP.last + 2, 0, PP.last + 3, 10,
                "Utilisation counts live projects only. Parked work is real, but it is "
                "not what the team is doing this week, so counting it would overstate "
                "the load. On-hold and upcoming work is in the columns beside it.",
                f["note"])


# ====================================================================== 6. clients
cli = sheet("Clients", tab=S1,
            title="Who eats the delivery team, and who pays for it",
            sub="Two percentages of the same 100%. Share of team is how much of the "
                "team's time a client uses; share of book is how much of the revenue "
                "it brings in. They should roughly match.",
            freeze=(3, 1))
CB = Table(cli, 2, [
    ("Client", 26), ("Client key", 14), ("Projects", 8, "r"), ("Live", 7, "r"),
    ("On hold", 8, "r"), ("Effort points", 10, "r"), ("Share of team", 10, "r"),
    ("Revenue", 14, "r"), (RUPEE + " Cr", 9, "r"), ("Share of book", 10, "r"),
    ("Pay vs. time", 10, "r"), ("Balance", 22), ("Revenue per point", 13, "r"),
    ("DMs", 7, "r"), ("Editor leads", 8, "r"), ("People", 8, "r"),
    ("Pod", 16), ("Updates 60d", 9, "r"),
    ("Kept in scenario", 10), ("Revenue after scenario", 14, "r"),
], n=len(D["clients"]))

scn = WS["Scenario"]
CHURN = [ref(scn, "$B$%d" % n) for n in (18, 19, 20)]      # filled in on the Scenario tab
UPLIFT = ref(scn, "$B$14")
NEWCR = ref(scn, "$B$15")

for i, c in enumerate(D["clients"]):
    r = CB.first + i
    rr = r - 1
    k = CB.c("Client key", r)
    cli.write(rr, CB.i("Client"), c["name"], f["bold"])
    cli.write(rr, CB.i("Client key"), c["key"], f["key"])
    cli.write_formula(rr, CB.i("Projects"), "=COUNTIF(%s,%s)" % (PJKEY, k), f["num"], c["projects"])
    cli.write_formula(rr, CB.i("Live"), '=COUNTIFS(%s,%s,%s,"active")' % (PJKEY, k, PJKIND),
                      f["num"], c["live"])
    cli.write_formula(rr, CB.i("On hold"), '=COUNTIFS(%s,%s,%s,"hold")' % (PJKEY, k, PJKIND),
                      f["num"], c["held"])
    cli.write_formula(rr, CB.i("Effort points"), "=SUMIF(%s,%s,%s)" % (PJKEY, k, PJPTS),
                      f["num2"], c["points"])
    cli.write_formula(rr, CB.i("Share of team"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (CB.c("Effort points", r), PJPTS),
                      f["pct"], c["teamShare"])
    cli.write_formula(rr, CB.i("Revenue"), "=SUMIF(%s,%s,%s)" % (PJKEY, k, PJREV),
                      f["money"], c["rev"])
    cli.write_formula(rr, CB.i(RUPEE + " Cr"), "=%s/10000000" % CB.c("Revenue", r),
                      f["cr"], c["rev"] / CR)
    cli.write_formula(rr, CB.i("Share of book"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (CB.c("Revenue", r), PJREV),
                      f["pct"], c["revShare"])
    cli.write_formula(rr, CB.i("Pay vs. time"),
                      "=IFERROR(%s/%s,0)" % (CB.c("Share of book", r), CB.c("Share of team", r)),
                      f["num2"], (c["revShare"] / c["teamShare"]) if c["teamShare"] else 0)
    cli.write_formula(rr, CB.i("Balance"),
                      '=IF(OR({rev}<=0,COUNTIFS({rk},{k},{rm},"not mapped")>0),'
                      '"Revenue not mapped",'
                      'IF({ra}>=1.5,"Pays well",IF({ra}>=0.8,"Balanced",'
                      'IF({ra}>=0.4,"Light on revenue","Costs more than it earns"))))'
                      .format(rev=CB.c("Revenue", r), rk=RVKEY, rm=RVMAP, k=k,
                              ra=CB.c("Pay vs. time", r)),
                      f["cell"], c["balance"])
    cli.write_formula(rr, CB.i("Revenue per point"),
                      '=IF(AND({p}>0,{v}>0),{v}/{p},"{e}")'
                      .format(p=CB.c("Effort points", r), v=CB.c("Revenue", r), e=EM),
                      f["money"], c["revPerPoint"] or 0)
    cli.write_formula(rr, CB.i("DMs"), distinct(ALPER, [(ALCKEY, k), (ALROLE, '"DM"')]),
                      f["num"], c["dmCount"])
    cli.write_formula(rr, CB.i("Editor leads"),
                      distinct(ALPER, [(ALCKEY, k), (ALROLE, '"Editor lead"')]),
                      f["num"], c["edCount"])
    cli.write_formula(rr, CB.i("People"),
                      "=%s+%s" % (CB.c("DMs", r), CB.c("Editor leads", r)), f["num"], c["people"])
    cli.write(rr, CB.i("Pod"), ", ".join(c["pods"]) or EM, f["mute"])
    cli.write_formula(rr, CB.i("Updates 60d"), "=SUMIF(%s,%s,%s)" % (PJKEY, k, PJACT),
                      f["num1"], c["activity"])
    cli.write_formula(rr, CB.i("Kept in scenario"),
                      '=IF(OR({a}={c},{b}={c},{d}={c}),"churned","kept")'
                      .format(a=CHURN[0], b=CHURN[1], d=CHURN[2], c=CB.c("Client", r)),
                      f["mute"], "kept")
    cli.write_formula(rr, CB.i("Revenue after scenario"),
                      '=IF({ks}="churned",0,{rev}*(1+{up}/100))'
                      .format(ks=CB.c("Kept in scenario", r), rev=CB.c("Revenue", r), up=UPLIFT),
                      f["money"], c["rev"])

tr = CB.last
cli.write(tr, 0, "%d clients with work on the board" % len(D["clients"]), f["total"])
for c2 in range(1, len(CB.idx)):
    cli.write_blank(tr, c2, None, f["total"])
cli.write_formula(tr, CB.i("Effort points"), "=SUM(%s)" % CB.rng("Effort points"),
                  f["totaln"], LT["totalPoints"])
cli.write_formula(tr, CB.i("Share of team"), "=SUM(%s)" % CB.rng("Share of team"),
                  f["totalpct"], 100)
cli.write_formula(tr, CB.i("Revenue"), "=SUM(%s)" % CB.rng("Revenue"), f["totalmoney"], T["rev"])
cli.write_formula(tr, CB.i(RUPEE + " Cr"), "=SUM(%s)" % CB.rng(RUPEE + " Cr"),
                  f["totalcr"], T["rev"] / CR)
cli.write_formula(tr, CB.i("Share of book"), "=SUM(%s)" % CB.rng("Share of book"),
                  f["totalpct"], 100)
cli.write_formula(tr, CB.i("Revenue after scenario"), "=SUM(%s)" % CB.rng("Revenue after scenario"),
                  f["totalmoney"], T["rev"])

lo, hi = CB.first - 1, CB.last - 1
cli.autofilter(CB.hrow, 0, CB.last - 1, len(CB.idx) - 1)
cli.conditional_format(lo, CB.i("Share of team"), hi, CB.i("Share of team"),
                       {"type": "data_bar", "bar_color": ACCENT, "bar_solid": True})
cli.conditional_format(lo, CB.i("Share of book"), hi, CB.i("Share of book"),
                       {"type": "data_bar", "bar_color": S3, "bar_solid": True})
for word, fmt in (("Costs more than it earns", f["crit"]), ("Light on revenue", f["warn"]),
                  ("Revenue not mapped", f["warn"]), ("Pays well", f["good"])):
    cli.conditional_format(lo, CB.i("Balance"), hi, CB.i("Balance"),
                           {"type": "text", "criteria": "containing", "value": word,
                            "format": fmt, "stop_if_true": True})
cli.merge_range(CB.last + 2, 0, CB.last + 3, 12,
                "Sorted heaviest first, so a client on a lot of team time for very "
                "little revenue surfaces near the top. Clients that are billed but "
                "carry no project row are on the Revenue tab, not here.", f["note"])

CBNAME, CBREVAFTER = ref(cli, CB.rng("Client")), ref(cli, CB.rng("Revenue after scenario"))
CBKEPT = ref(cli, CB.rng("Kept in scenario"))
CBREV = ref(cli, CB.rng("Revenue"))


# ====================================================================== 7. pods
pod = sheet("Pods", tab=S7,
            title="The three pods",
            sub="Everything a pod owner is accountable for, rolled up from the same "
                "project rows.", freeze=(3, 1))
PD = Table(pod, 2, [
    ("Pod owner", 20), ("Projects", 9, "r"), ("Live", 8, "r"), ("On hold", 8, "r"),
    ("Upcoming", 9, "r"), ("Effort points", 11, "r"), ("Share of team", 11, "r"),
    ("Clients", 9, "r"), ("DMs", 8, "r"), ("Editor leads", 10, "r"),
    ("Projects per DM", 11, "r"), ("Revenue", 15, "r"), (RUPEE + " Cr", 10, "r"),
    ("Share of book", 11, "r"), ("Risk score", 10, "r"),
], n=len(D["pods"]))

for i, g in enumerate(D["pods"]):
    r = PD.first + i
    rr = r - 1
    k = PD.c("Pod owner", r)
    pod.write(rr, PD.i("Pod owner"), g["name"], f["bold"])
    pod.write_formula(rr, PD.i("Projects"), "=COUNTIF(%s,%s)" % (PJPOD, k), f["num"], g["projects"])
    for cn, kind, val in (("Live", "active", g["active"]), ("On hold", "hold", g["hold"]),
                          ("Upcoming", "upcoming", g["upcoming"])):
        pod.write_formula(rr, PD.i(cn), '=COUNTIFS(%s,%s,%s,"%s")' % (PJPOD, k, PJKIND, kind),
                          f["num"], val)
    pod.write_formula(rr, PD.i("Effort points"), "=SUMIF(%s,%s,%s)" % (PJPOD, k, PJPTS),
                      f["num2"], 0)
    pod.write_formula(rr, PD.i("Share of team"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (PD.c("Effort points", r), PJPTS),
                      f["pct"], 0)
    pod.write_formula(rr, PD.i("Clients"), distinct(PJKEY, [(PJPOD, k)]), f["num"], g["clientCount"])
    pod.write_formula(rr, PD.i("DMs"), distinct(ALPER, [(ALPOD, k), (ALROLE, '"DM"')]),
                      f["num"], g["dmCount"])
    pod.write_formula(rr, PD.i("Editor leads"),
                      distinct(ALPER, [(ALPOD, k), (ALROLE, '"Editor lead"')]),
                      f["num"], g["edCount"])
    pod.write_formula(rr, PD.i("Projects per DM"),
                      "=IFERROR(%s/%s,0)" % (PD.c("Projects", r), PD.c("DMs", r)),
                      f["num1"], g["loadPerDM"])
    pod.write_formula(rr, PD.i("Revenue"), "=SUMIF(%s,%s,%s)" % (PJPOD, k, PJREV),
                      f["money"], g["rev"])
    pod.write_formula(rr, PD.i(RUPEE + " Cr"), "=%s/10000000" % PD.c("Revenue", r),
                      f["cr"], g["rev"] / CR)
    pod.write_formula(rr, PD.i("Share of book"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (PD.c("Revenue", r), PJREV),
                      f["pct"], g["rev"] / T["rev"] * 100)
    pod.write_formula(rr, PD.i("Risk score"), "=SUMIF(%s,%s,%s)" % (PJPOD, k, PJRISK),
                      f["num"], g["risk"])

tr = PD.last
pod.write(tr, 0, "All pods", f["total"])
for c2 in range(1, len(PD.idx)):
    pod.write_blank(tr, c2, None, f["total"])
for cn, fmt in (("Projects", "totaln"), ("Live", "totaln"), ("On hold", "totaln"),
                ("Effort points", "totaln"), ("Share of team", "totalpct"),
                ("Revenue", "totalmoney"), (RUPEE + " Cr", "totalcr"),
                ("Share of book", "totalpct")):
    pod.write_formula(tr, PD.i(cn), "=SUM(%s)" % PD.rng(cn), f[fmt], 0)
pod.conditional_format(PD.first - 1, PD.i("Share of team"), PD.last - 1, PD.i("Share of team"),
                       {"type": "data_bar", "bar_color": ACCENT, "bar_solid": True})


# ====================================================================== 8. service lines
svc = sheet("Service lines", tab=S4,
            title="What the team actually makes",
            sub="A project on two service lines counts half on each, which is why "
                "these are fractional and why they still add back to the whole book.",
            freeze=(3, 1))
SV = Table(svc, 2, [
    ("Service line", 24), ("Effort weight", 11, "r"), ("Project rows", 11, "r"),
    ("Live", 9, "r"), ("Effort points", 11, "r"), ("Share of team", 11, "r"),
    ("Revenue", 15, "r"), (RUPEE + " Cr", 10, "r"), ("Share of book", 11, "r"),
    ("Revenue per point", 14, "r"),
], n=len(D["categories"]))

pts_by_svc = {g["name"]: g["points"] for g in D["loadByService"]}
for i, g in enumerate(D["categories"]):
    r = SV.first + i
    rr = r - 1
    nm = SV.c("Service line", r)
    if g["name"] == "(uncategorised)":
        mask = "(%s=0)" % PJNLINES
        weight = "1"
    else:
        mask = "ISNUMBER(SEARCH(%s,%s))" % (nm, PJLINES)
        weight = "{n}+({n}=0)".format(n=PJNLINES)
    svc.write(rr, SV.i("Service line"), g["name"], f["bold"])
    svc.write_formula(rr, SV.i("Effort weight"),
                      '=IFERROR(VLOOKUP(%s,EffortWeights,2,FALSE),"%s")' % (nm, EM),
                      f["num"], D["effortWeights"].get(g["name"], ""))
    svc.write_formula(rr, SV.i("Project rows"),
                      "=SUMPRODUCT((%s)*1/(%s))" % (mask, weight), f["num1"], g["projects"])
    svc.write_formula(rr, SV.i("Live"),
                      '=SUMPRODUCT((%s)*(%s="active")/(%s))' % (mask, PJKIND, weight),
                      f["num1"], g["active"])
    svc.write_formula(rr, SV.i("Effort points"),
                      "=SUMPRODUCT((%s)*%s/(%s))" % (mask, PJPTS, weight),
                      f["num2"], pts_by_svc.get(g["name"], 0))
    svc.write_formula(rr, SV.i("Share of team"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (SV.c("Effort points", r), PJPTS),
                      f["pct"], pts_by_svc.get(g["name"], 0) / LT["totalPoints"] * 100)
    svc.write_formula(rr, SV.i("Revenue"),
                      "=SUMPRODUCT((%s)*%s/(%s))" % (mask, PJREV, weight), f["money"], g["rev"])
    svc.write_formula(rr, SV.i(RUPEE + " Cr"), "=%s/10000000" % SV.c("Revenue", r),
                      f["cr"], g["rev"] / CR)
    svc.write_formula(rr, SV.i("Share of book"),
                      "=IFERROR(%s/SUM(%s)*100,0)" % (SV.c("Revenue", r), PJREV),
                      f["pct"], g["rev"] / T["rev"] * 100)
    svc.write_formula(rr, SV.i("Revenue per point"),
                      '=IFERROR({v}/{p},"{e}")'.format(v=SV.c("Revenue", r),
                                                       p=SV.c("Effort points", r), e=EM),
                      f["money"], 0)

tr = SV.last
svc.write(tr, 0, "Whole book", f["total"])
for c2 in range(1, len(SV.idx)):
    svc.write_blank(tr, c2, None, f["total"])
for cn, fmt in (("Project rows", "totaln"), ("Live", "totaln"), ("Effort points", "totaln"),
                ("Share of team", "totalpct"), ("Revenue", "totalmoney"),
                (RUPEE + " Cr", "totalcr"), ("Share of book", "totalpct")):
    svc.write_formula(tr, SV.i(cn), "=SUM(%s)" % SV.rng(cn), f[fmt], 0)
svc.conditional_format(SV.first - 1, SV.i("Share of book"), SV.last - 1, SV.i("Share of book"),
                       {"type": "data_bar", "bar_color": S4, "bar_solid": True})


# ====================================================================== 9. escalations
esc_ids = D["escalations"]
esc = sheet("Escalations", tab=S8,
            title="What is on fire, worst first",
            sub="Severity drives the order, an open blocker adds to it, silence adds "
                "to both, and revenue only breaks ties " + EM + " a " + RUPEE
                + "0 project can still be the one that burns you.",
            freeze=(3, 3), zoom=90)
ES = Table(esc, 2, [
    ("#", 5, "r"), ("Client", 22), ("Project", 24), ("Score", 8, "r"), ("Status", 10),
    ("Update state", 12), ("Days since update", 10, "r"), ("Days overdue", 10, "r"),
    ("What is wrong", 50), ("Open blocker", 38), ("Who to call", 16),
    ("DMs", 22), ("Editor leads", 22), ("Revenue", 14, "r"), (RUPEE + " Cr", 9, "r"),
    ("Last update", 11, "r"),
], n=len(esc_ids))

byid = {p["id"]: p for p in P}
for i, pid in enumerate(esc_ids):
    p = byid[pid]
    r = ES.first + i
    rr = r - 1
    src = prow[pid]
    g = lambda cn: '=IF({r}="","",{r})'.format(r=ref(prj, PJ.c(cn, src)))
    esc.write_number(rr, ES.i("#"), i + 1, f["num"])
    esc.write_formula(rr, ES.i("Client"), g("Client"), f["bold"], p["client"])
    esc.write_formula(rr, ES.i("Project"), g("Project"), f["cell"], p["projectName"] or EM)
    esc.write_number(rr, ES.i("Score"), round(p["escalation"], 1), f["num1"])
    esc.write_formula(rr, ES.i("Status"), g("Status"), f["mute"], p["status"])
    esc.write_formula(rr, ES.i("Update state"), g("Update state"), f["cell"], "")
    esc.write_formula(rr, ES.i("Days since update"), g("Days since update"), f["num"],
                      p["staleDays"] if p["staleDays"] is not None else "")
    esc.write_formula(rr, ES.i("Days overdue"), g("Days overdue"), f["num"],
                      p["overdueDays"] or "")
    esc.write_formula(rr, ES.i("What is wrong"), g("What is wrong"), f["cellw"], "")
    esc.write_formula(rr, ES.i("Open blocker"), g("Open blocker"), f["cellw"], p["blocker"])
    esc.write_formula(rr, ES.i("Who to call"), g("Pod owner"), f["cell"], p["podOwner"] or EM)
    esc.write(rr, ES.i("DMs"), ", ".join(p["dms"]) or "nobody assigned", f["mute"])
    esc.write(rr, ES.i("Editor leads"), ", ".join(p["editorLeads"]) or "nobody assigned", f["mute"])
    esc.write_formula(rr, ES.i("Revenue"), g("Revenue attributed"), f["money"], p["rev"])
    esc.write_formula(rr, ES.i(RUPEE + " Cr"), "=%s/10000000" % ES.c("Revenue", r),
                      f["cr"], p["rev"] / CR)
    esc.write_formula(rr, ES.i("Last update"), g("Last update"), f["date"], "")

lo, hi = ES.first - 1, ES.last - 1
esc.autofilter(ES.hrow, 0, hi, len(ES.idx) - 1)
esc.conditional_format(lo, ES.i("Score"), hi, ES.i("Score"),
                       {"type": "data_bar", "bar_color": "#F3B8B8", "bar_solid": True,
                        "min_type": "num", "min_value": 0})
esc.conditional_format(lo, ES.i("Days overdue"), hi, ES.i("Days overdue"),
                       {"type": "cell", "criteria": ">", "value": 0, "format": f["crit"]})
for word, fmt in (("very stale", f["crit"]), ("never updated", f["crit"]),
                  ("stale", f["warn"]), ("current", f["good"])):
    esc.conditional_format(lo, ES.i("Update state"), hi, ES.i("Update state"),
                           {"type": "text", "criteria": "containing", "value": word,
                            "format": fmt, "stop_if_true": True})
esc.conditional_format(lo, ES.i("Open blocker"), hi, ES.i("Open blocker"),
                       {"type": "no_blanks", "format": f["crit"]})


# ====================================================================== 10. timeline
def bar_dates(p):
    s, e = p["start"], p["end"]
    if not s and e:
        s = e
    if s and not e:
        e = None if p["openEnded"] else s
    return s, e


dated = [p for p in P if p["start"] or p["end"]]
undated = [p for p in P if not (p["start"] or p["end"])]
dated.sort(key=lambda p: (bar_dates(p)[0] or "9999", p["client"].lower()))
undated.sort(key=lambda p: (p["client"].lower(), p["projectName"] or ""))

alld = []
for p in dated:
    s, e = bar_dates(p)
    if s:
        alld.append(iso(s))
    if e:
        alld.append(iso(e))
alld.append(TODAY)
lo_d, hi_d = min(alld), max(alld)
months = []
y, m = lo_d.year, lo_d.month
while (y, m) <= (hi_d.year, hi_d.month):
    months.append((y, m))
    m += 1
    if m == 13:
        y, m = y + 1, 1

tl = sheet("Timeline", tab=S5,
           title="When the work lands",
           sub="Only " + str(len(dated)) + " of " + str(len(P)) + " rows arrived with a "
               "usable date. The rest are listed underneath, which is the honest way "
               "to show a Gantt built on a third of the dates.",
           freeze=(3, 7), zoom=85)
TLCOLS = [("Client", 22), ("Project", 24), ("Pod owner", 15), ("Status", 10),
          ("DM", 16), ("Start", 11, "r"), ("End", 11, "r"),
          ("Bar start", 10, "r"), ("Bar end", 10, "r")]
MONNAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
for (yy, mm) in months:
    TLCOLS.append((MONNAMES[mm - 1] + " " + str(yy)[2:], 5, "r"))
TL = Table(tl, 2, TLCOLS, n=len(dated) + len(undated) + 2)
tl.set_column(TL.i("Bar start"), TL.i("Bar end"), 10, None, {"hidden": True})

barfmt = F(bg_color=ACCENT, font_color=ACCENT, border=1, border_color="#FFFFFF")
todayfmt = F(bg_color="#FFF3B0")
gridfmt = F(bottom=1, border_color=LINE, num_format=";;;")

row = TL.first
for p in dated:
    rr = row - 1
    tl.write(rr, TL.i("Client"), p["client"], f["cell"])
    tl.write(rr, TL.i("Project"), p["projectName"] or EM, f["cell"])
    tl.write(rr, TL.i("Pod owner"), p["podOwner"] or EM, f["mute"])
    tl.write(rr, TL.i("Status"), p["status"], f["mute"])
    tl.write(rr, TL.i("DM"), ", ".join(p["dms"]) or EM, f["mute"])
    s, e = p["start"], p["end"]
    if s:
        tl.write_datetime(rr, TL.i("Start"), iso(s), f["date"])
    else:
        tl.write(rr, TL.i("Start"), EM, f["mute"])
    if e:
        tl.write_datetime(rr, TL.i("End"), iso(e), f["date"])
    else:
        tl.write(rr, TL.i("End"), "open" if p["openEnded"] else EM, f["mute"])
    bs, be = bar_dates(p)
    tl.write_formula(rr, TL.i("Bar start"),
                     '=IF(ISNUMBER({s}),{s},IF(ISNUMBER({e}),{e},""))'
                     .format(s=TL.c("Start", row), e=TL.c("End", row)),
                     f["date"], serial(iso(bs)))
    tl.write_formula(rr, TL.i("Bar end"),
                     '=IF(ISNUMBER({e}),{e},IF(AND(ISNUMBER({s}),{o}="open"),DATE(2099,1,1),'
                     'IF(ISNUMBER({s}),{s},"")))'
                     .format(s=TL.c("Start", row), e=TL.c("End", row), o=TL.c("End", row)),
                     f["date"], serial(iso(be)))
    for j, (yy, mm) in enumerate(months):
        ny, nm2 = (yy + 1, 1) if mm == 12 else (yy, mm + 1)
        cn = MONNAMES[mm - 1] + " " + str(yy)[2:]
        on = bool(bs) and iso(bs) < __import__("datetime").date(ny, nm2, 1) and \
            (not be or iso(be) >= __import__("datetime").date(yy, mm, 1)) and \
            (be or p["openEnded"] or (bs and iso(bs) >= __import__("datetime").date(yy, mm, 1)))
        tl.write_formula(rr, TL.i(cn),
                         '=IF(AND(ISNUMBER({a}),{a}<DATE({ny},{nm},1),{b}>=DATE({y},{m},1)),1,"")'
                         .format(a=TL.c("Bar start", row), b=TL.c("Bar end", row),
                                 ny=ny, nm=nm2, y=yy, m=mm),
                         gridfmt, 1 if on else "")
    row += 1

row += 1
tl.merge_range(row - 1, 0, row - 1, 6,
               "No dates on the board " + EM + " " + str(len(undated)) + " rows", f["wash"])
row += 1
for p in undated:
    rr = row - 1
    tl.write(rr, TL.i("Client"), p["client"], f["cell"])
    tl.write(rr, TL.i("Project"), p["projectName"] or EM, f["cell"])
    tl.write(rr, TL.i("Pod owner"), p["podOwner"] or EM, f["mute"])
    tl.write(rr, TL.i("Status"), p["status"], f["mute"])
    tl.write(rr, TL.i("DM"), ", ".join(p["dms"]) or EM, f["mute"])
    note = p["startNote"] or p["endNote"]
    tl.write(rr, TL.i("Start"), (PEN + " " + note) if note else EM, f["mute"])
    tl.write(rr, TL.i("End"), "TBD" if p["datesUnknown"] else EM, f["mute"])
    row += 1

m0, mN = TL.i(MONNAMES[months[0][1] - 1] + " " + str(months[0][0])[2:]), len(TLCOLS) - 1
tl.conditional_format(TL.first - 1, m0, TL.first - 2 + len(dated), mN,
                      {"type": "cell", "criteria": "==", "value": 1, "format": barfmt})
tcol = None
for j, (yy, mm) in enumerate(months):
    if (yy, mm) == (TODAY.year, TODAY.month):
        tcol = m0 + j
if tcol is not None:
    tl.write(TL.hrow, tcol, MONNAMES[TODAY.month - 1] + " " + str(TODAY.year)[2:],
             F(bold=True, font_size=9, bg_color="#FFF3B0", bottom=1, border_color=LINE,
               text_wrap=True, valign="bottom", align="right"))


# ====================================================================== 11. updates
upd = sheet("Updates", tab=S6,
            title="Every status update anyone has posted",
            sub="Straight from the board's standup tab, newest first. Future-dated "
                "rows are plans, not progress " + EM + " that is why the board never "
                "counts them as a recent update.",
            freeze=(3, 1), zoom=90)
UP = Table(upd, 2, [
    ("Date", 11, "r"), ("When", 10), ("Client", 22), ("Project", 22), ("Author", 18),
    ("Posted as", 12), ("Update", 76), ("Blockers", 40), ("ETA", 16),
], n=len(D["updates"]))

pbyid = {p["id"]: p for p in P}
ups = sorted(D["updates"], key=lambda u: (u["date"] or ""), reverse=True)
for i, u in enumerate(ups):
    r = UP.first + i
    rr = r - 1
    p = pbyid.get(u["projectId"], {})
    if u["date"]:
        upd.write_datetime(rr, UP.i("Date"), iso(u["date"]), f["date"])
    else:
        upd.write(rr, UP.i("Date"), EM, f["mute"])
    upd.write_formula(rr, UP.i("When"),
                      '=IF(NOT(ISNUMBER({d})),"",IF({d}>AsOf,"planned",'
                      'IF({d}=AsOf,"today","posted")))'.format(d=UP.c("Date", r)),
                      f["mute"], "")
    upd.write(rr, UP.i("Client"), p.get("client", EM), f["cell"])
    upd.write(rr, UP.i("Project"), p.get("projectName") or EM, f["cell"])
    upd.write(rr, UP.i("Author"), u["author"], f["cell"])
    upd.write(rr, UP.i("Posted as"), u["role"] or EM, f["mute"])
    upd.write(rr, UP.i("Update"), u["text"], f["cellw"])
    upd.write(rr, UP.i("Blockers"), u["blockers"], f["cellw"])
    upd.write(rr, UP.i("ETA"), u["eta"], f["mute"])

lo, hi = UP.first - 1, UP.last - 1
upd.autofilter(UP.hrow, 0, hi, len(UP.idx) - 1)
upd.conditional_format(lo, UP.i("Blockers"), hi, UP.i("Blockers"),
                       {"type": "no_blanks", "format": f["crit"]})
upd.conditional_format(lo, UP.i("When"), hi, UP.i("When"),
                       {"type": "text", "criteria": "containing", "value": "planned",
                        "format": f["warn"]})


# ====================================================================== 12. scenario
PJCLI = ref(prj, PJ.rng("Client"))
KEPT = "(({c}=$B$18)+({c}=$B$19)+({c}=$B$20)=0)".format(c=PJCLI)

sheet("Scenario", tab=S2,
      title="Run the numbers",
      sub="Move a shaded cell and the right-hand table answers. Nothing here writes "
          "back to the board " + EM + " it is a sandbox, and closing without saving "
          "loses nothing.")
for c, w in ((0, 38), (1, 14), (2, 46), (3, 3), (4, 32), (5, 14), (6, 14), (7, 12),
             (8, 3), (9, 30), (10, 16)):
    scn.set_column(c, c, w)

scn.write("A4", "THE TEAM", f["eyebrow"])
scn.write("A5", "Lever", f["th"])
scn.write("B5", "Value", f["thr"])
scn.write("C5", "What it does", f["th"])
levers = [
    ("A6", "B6", "C6", "DMs hired (+) or lost (" + "−" + ")", 0, "input",
     "Changes the denominator on projects per DM, and the cost line."),
    ("A7", "B7", "C7", "Editor leads hired (+) or lost (" + "−" + ")", 0, "input",
     "Same, for the role that is currently the constraint."),
    ("A8", "B8", "C8", "Restart parked work (% of on-hold)", 0, "inputpct",
     "Brings that share of the 29 on-hold projects back to live, with their revenue."),
]
for a, b, c, label, val, fmt, note in levers:
    scn.write(a, label, f["cell"])
    scn.write_number(b, val, f[fmt])
    scn.write(c, note, f["note"])

scn.write("A11", "THE BOOK", f["eyebrow"])
scn.write("A13", "Lever", f["th"])
scn.write("B13", "Value", f["thr"])
scn.write("C13", "What it does", f["th"])
scn.write("A14", "Price uplift across the whole book (%)", f["cell"])
scn.write_number("B14", 0, f["inputpct"])
scn.write("C14", "Applied to every client that survives the churn list below.", f["note"])
scn.write("A15", "New business won (" + RUPEE + " Cr)", f["cell"])
scn.write_number("B15", 0, f["input"])
scn.write("C15", "Assumed to arrive as roughly one project per " + RUPEE
          + "0.5 Cr, at least one.", f["note"])

scn.write("A17", "CLIENTS YOU ASSUME YOU LOSE", f["eyebrow"])
scn.write("C17", "Pick from the list. Their revenue leaves the book and their project "
                 "rows leave the count.", f["note"])
for i in range(3):
    rr = 18 + i
    scn.write("A%d" % rr, "Client %d" % (i + 1), f["cell"])
    scn.write_blank("B%d" % rr, None, f["inputtxt"])
    scn.write_formula("C%d" % rr,
                      '=IF($B$%d="","",TEXT(SUMIF(%s,$B$%d,%s)/10000000,"0.00")&" Cr at stake")'
                      % (rr, CBNAME, rr, CBREV), f["mute"], "")
scn.data_validation("B18:B20", {"validate": "list", "source": "=" + CBNAME,
                                "input_title": "Client",
                                "input_message": "Pick a client to model losing."})

# ------------------------------------------------------------------ working
scn.write("J4", "WORKING", f["eyebrow"])
scn.write("K4", "", f["eyebrow"])
work = [
    ("Live projects today", '=COUNTIF(%s,"active")' % PJKIND, T["active"], "num"),
    ("On hold today", '=COUNTIF(%s,"hold")' % PJKIND, T["hold"], "num"),
    ("DMs today", distinct(ALPER, [(ALROLE, '"DM"')]), T["dmCount"], "num"),
    ("Editor leads today", distinct(ALPER, [(ALROLE, '"Editor lead"')]), T["edCount"], "num"),
    ("Book today", "=SUM(%s)" % PJREV, T["rev"], "money"),
    ("Active revenue today", '=SUMIF(%s,"active",%s)' % (PJKIND, PJREV), T["activeRev"], "money"),
    ("On-hold revenue today", '=SUMIF(%s,"hold",%s)' % (PJKIND, PJREV), T["holdRev"], "money"),
    ("Project rows today", "=COUNTA(%s)" % PJKEY, T["n"], "num"),
    ("Book kept after churn", "=SUMPRODUCT(%s*%s)" % (KEPT, PJREV), T["rev"], "money"),
    ("Active revenue kept", '=SUMPRODUCT(%s*(%s="active")*%s)' % (KEPT, PJKIND, PJREV),
     T["activeRev"], "money"),
    ("On-hold revenue kept", '=SUMPRODUCT(%s*(%s="hold")*%s)' % (KEPT, PJKIND, PJREV),
     T["holdRev"], "money"),
    ("Project rows lost", "=COUNTIF({c},$B$18)+COUNTIF({c},$B$19)+COUNTIF({c},$B$20)"
     .format(c=PJCLI), 0, "num"),
    ("New revenue", "=$B$15*10000000", 0, "money"),
    ("New project rows", "=IF($B$15>0,MAX(1,ROUND($B$15/0.5,0)),0)", 0, "num"),
    ("Live projects kept", '=SUMPRODUCT(%s*(%s="active"))' % (KEPT, PJKIND),
     T["active"], "num"),
    ("On hold kept", '=SUMPRODUCT(%s*(%s="hold"))' % (KEPT, PJKIND), T["hold"], "num"),
    ("Live projects after", "=$K$19+ROUND($K$20*$B$8/100,0)", T["active"], "num"),
    ("DMs after", "=MAX(1,$K$7+$B$6)", T["dmCount"], "num"),
    ("Editor leads after", "=MAX(1,$K$8+$B$7)", T["edCount"], "num"),
    ("Book after", "=$K$13*(1+$B$14/100)+$K$17", T["rev"], "money"),
    ("Active revenue after", "=($K$14+$K$15*$B$8/100)*(1+$B$14/100)+$K$17",
     T["activeRev"], "money"),
    ("Project rows after", "=$K$12-$K$16+$K$18", T["n"], "num"),

    ("Biggest client after", "=MAX(MAX(%s),$K$17)" % CBREVAFTER,
     max(c["rev"] for c in D["clients"]), "money"),
]
W = {}
for i, (label, formula, val, fmt) in enumerate(work):
    rr = 5 + i
    scn.write("J%d" % rr, label, f["mute"])
    scn.write_formula("K%d" % rr, formula, f[fmt], val)
    W[label] = "$K$%d" % rr

# ------------------------------------------------------------ before and after
scn.write("E4", "BEFORE AND AFTER", f["eyebrow"])
scn.write("E5", "Measure", f["th"])
scn.write("F5", "Today", f["thr"])
scn.write("G5", "After the levers", f["thr"])
scn.write("H5", "Change", f["thr"])

cost_now = T["dmCount"] * SET["costPerDM"] + T["edCount"] * SET["costPerEditor"]
K = W
measures = [
    ("Book of business (" + RUPEE + " Cr)", "=%s/10000000" % K["Book today"],
     "=%s/10000000" % K["Book after"], T["rev"] / CR, T["rev"] / CR, "num2"),
    ("Active revenue (" + RUPEE + " Cr)", "=%s/10000000" % K["Active revenue today"],
     "=%s/10000000" % K["Active revenue after"], T["activeRev"] / CR, T["activeRev"] / CR, "num2"),
    ("Project rows", "=%s" % K["Project rows today"], "=%s" % K["Project rows after"],
     T["n"], T["n"], "num"),
    ("Live projects", "=%s" % K["Live projects today"], "=%s" % K["Live projects after"],
     T["active"], T["active"], "num"),
    ("DMs", "=%s" % K["DMs today"], "=%s" % K["DMs after"], T["dmCount"], T["dmCount"], "num"),
    ("Editor leads", "=%s" % K["Editor leads today"], "=%s" % K["Editor leads after"],
     T["edCount"], T["edCount"], "num"),
    ("Live projects per DM", "={a}/{b}".format(a=K["Live projects today"], b=K["DMs today"]),
     "={a}/{b}".format(a=K["Live projects after"], b=K["DMs after"]),
     T["active"] / T["dmCount"], T["active"] / T["dmCount"], "num1"),
    ("Live projects per editor lead",
     "={a}/{b}".format(a=K["Live projects today"], b=K["Editor leads today"]),
     "={a}/{b}".format(a=K["Live projects after"], b=K["Editor leads after"]),
     T["active"] / T["edCount"], T["active"] / T["edCount"], "num1"),
    ("DM utilisation (%)", "={a}/{b}/CapDM*100".format(a=K["Live projects today"], b=K["DMs today"]),
     "={a}/{b}/CapDM*100".format(a=K["Live projects after"], b=K["DMs after"]),
     T["active"] / T["dmCount"] / SET["capacityPerDM"] * 100,
     T["active"] / T["dmCount"] / SET["capacityPerDM"] * 100, "pct"),
    ("Editor lead utilisation (%)",
     "={a}/{b}/CapEd*100".format(a=K["Live projects today"], b=K["Editor leads today"]),
     "={a}/{b}/CapEd*100".format(a=K["Live projects after"], b=K["Editor leads after"]),
     T["active"] / T["edCount"] / SET["capacityPerEditor"] * 100,
     T["active"] / T["edCount"] / SET["capacityPerEditor"] * 100, "pct"),
    ("DMs needed at the ceiling", "=CEILING(%s/CapDM,1)" % K["Live projects today"],
     "=CEILING(%s/CapDM,1)" % K["Live projects after"], 8, 8, "num"),
    ("Editor leads needed at the ceiling", "=CEILING(%s/CapEd,1)" % K["Live projects today"],
     "=CEILING(%s/CapEd,1)" % K["Live projects after"], 7, 7, "num"),
    ("Delivery team cost (" + RUPEE + " Cr)",
     "=({d}*CostDM+{e}*CostEd)/10000000".format(d=K["DMs today"], e=K["Editor leads today"]),
     "=({d}*CostDM+{e}*CostEd)/10000000".format(d=K["DMs after"], e=K["Editor leads after"]),
     cost_now / CR, cost_now / CR, "num2"),
    ("Contribution (" + RUPEE + " Cr)", "=$F$6-$F$18", "=$G$6-$G$18",
     (T["rev"] - cost_now) / CR, (T["rev"] - cost_now) / CR, "num2"),
    ("Margin (%)", "=IFERROR($F$19/$F$6*100,0)", "=IFERROR($G$19/$G$6*100,0)",
     (T["rev"] - cost_now) / T["rev"] * 100, (T["rev"] - cost_now) / T["rev"] * 100, "pct"),
    ("Biggest client's share of the book (%)",
     "=MAX(%s)/%s*100" % (CBREV, K["Book today"]),
     "=IFERROR(%s/%s*100,0)" % (K["Biggest client after"], K["Book after"]),
     CONC["top1"] * 100, CONC["top1"] * 100, "pct"),
    ("Gap to the target (" + RUPEE + " Cr)", "=TargetCr-%s/10000000" % K["Book today"],
     "=TargetCr-%s/10000000" % K["Book after"],
     SET["targetRevenueCr"] - T["rev"] / CR, SET["targetRevenueCr"] - T["rev"] / CR, "num2"),
]
MROW = {}
for i, (label, fnow, fafter, vnow, vafter, fmt) in enumerate(measures):
    rr = 6 + i
    MROW[label] = rr
    scn.write("E%d" % rr, label, f["cell"])
    scn.write_formula("F%d" % rr, fnow, f[fmt], vnow)
    scn.write_formula("G%d" % rr, fafter, f[fmt], vafter)
    scn.write_formula("H%d" % rr, '=IF(ABS($G${r}-$F${r})<0.05,"{e}",TEXT($G${r}-$F${r},"+#,##0.0;-#,##0.0"))'
                      .format(r=rr, e=EM), f["mute"], EM)

vr = 6 + len(measures) + 1
scn.merge_range("E%d:H%d" % (vr, vr + 1), "", f["vhot"])
scn.write_formula(
    "E%d" % vr,
    '=IF($G${u}<=100,"{t} After these levers every role is inside its ceiling.",'
    '"{w} Editor leads are still at "&TEXT($G${u},"0")&"% of their ceiling. '
    'Clearing that needs "&$G${n}&" of them, "&($G${n}-$G${e})&" more than this '
    'scenario hires.")'.format(u=MROW["Editor lead utilisation (%)"],
                               n=MROW["Editor leads needed at the ceiling"],
                               e=MROW["Editor leads"], t=TICK, w=WARN),
    f["vhot"], "")
scn.set_row(vr - 1, 20)
scn.set_row(vr, 20)

scn.merge_range("A22:C26",
                "Reset: put every shaded cell back to 0 and clear the three client "
                "names. The Today and After columns then agree exactly, which is the "
                "quickest way to check you have not left a lever on.", f["note"])

# a three-row block so the chart compares like with like
scn.write("J28", "CHART DATA", f["eyebrow"])
scn.write("K28", "Today", f["thr"])
scn.write("L28", "After", f["thr"])
scn.set_column(11, 11, 14)
for i, (label, mrow) in enumerate([
        ("Book of business", MROW["Book of business (" + RUPEE + " Cr)"]),
        ("Delivery team cost", MROW["Delivery team cost (" + RUPEE + " Cr)"]),
        ("Contribution", MROW["Contribution (" + RUPEE + " Cr)"])]):
    rr = 29 + i
    scn.write("J%d" % rr, label, f["mute"])
    scn.write_formula("K%d" % rr, "=$F$%d" % mrow, f["num2"], 0)
    scn.write_formula("L%d" % rr, "=$G$%d" % mrow, f["num2"], 0)

ch = wb.add_chart({"type": "column"})
for name, col, colr in (("Today", 10, INK3), ("After the levers", 11, ACCENT)):
    ch.add_series({
        "name": name,
        "categories": ["Scenario", 28, 9, 30, 9],
        "values": ["Scenario", 28, col, 30, col],
        "fill": {"color": colr}, "border": {"none": True}, "gap": 60,
    })
ch.set_title({"name": "The money, before and after (" + RUPEE + " Cr)",
              "name_font": {"size": 11, "bold": True, "name": "Aptos Narrow"}})
ch.set_legend({"position": "bottom", "font": {"size": 9, "name": "Aptos Narrow"}})
ch.set_x_axis({"num_font": {"size": 9, "name": "Aptos Narrow"}, "line": {"color": LINE}})
ch.set_y_axis({"num_font": {"size": 9, "name": "Aptos Narrow"},
               "major_gridlines": {"visible": True, "line": {"color": "#EFEFF2"}}})
ch.set_chartarea({"border": {"color": LINE}, "fill": {"color": "#FFFFFF"}})
ch.set_plotarea({"fill": {"color": "#FFFFFF"}})
ch.set_size({"width": 520, "height": 300})
scn.insert_chart("E%d" % (vr + 3), ch)


# ====================================================================== 13. dashboard
dash = WS["Dashboard"]
dash.set_tab_color(ACCENT)
dash.hide_gridlines(2)
dash.set_zoom(100)
dash.set_paper(9)
dash.set_landscape()
dash.fit_to_pages(1, 2)
for c in range(15):
    dash.set_column(c, c, 9.0)
dash.set_column(15, 40, 2)

dash.merge_range("A1:O1", SET.get("orgName", "TrueFan") + " " + EM + " delivery and revenue",
                 f["title"])
dash.set_row(0, 30)
dash.merge_range("A2:O2",
                 "The operations board on one page. Data saved "
                 + D["updatedAt"][:10] + ". Every figure here is a formula over the "
                 "tabs behind it " + EM + " change an assumption and this page moves.",
                 f["sub"])
dash.set_row(1, 15)


def kv(numfmt, accent=False):
    return F(font_size=20, bold=True, font_color=ACCENT_INK if accent else INK,
             bg_color=SURFACE, left=1, right=1, border_color=LINE,
             valign="vcenter", indent=1, num_format=numfmt)


def tile(r, c0, label, formula, value, numfmt, note_formula, note_value, accent=False):
    """r is 0-indexed and points at the label row of a three-row tile."""
    fmt = kv(numfmt, accent)
    dash.merge_range(r, c0, r, c0 + 2, label, f["kpi_k"])
    dash.merge_range(r + 1, c0, r + 1, c0 + 2, "", fmt)
    dash.write_formula(r + 1, c0, formula, fmt, value)
    dash.merge_range(r + 2, c0, r + 2, c0 + 2, "", f["kpi_n"])
    dash.write_formula(r + 2, c0, note_formula, f["kpi_n"], note_value)
    dash.set_row(r, 15)
    dash.set_row(r + 1, 30)
    dash.set_row(r + 2, 29)


# the working block the whole page reads, parked at the bottom
WROW = 86
dash.merge_range("A%d:O%d" % (WROW - 1, WROW - 1),
                 "WORKING " + EM + " the front page reads these; they read the tabs behind it",
                 f["wash"])
dwork = [
    ("Live projects", '=COUNTIF(%s,"active")' % PJKIND, T["active"], "num"),
    ("On hold", '=COUNTIF(%s,"hold")' % PJKIND, T["hold"], "num"),
    ("Upcoming", '=COUNTIF(%s,"upcoming")' % PJKIND, T["upcoming"], "num"),
    ("Project rows", "=COUNTA(%s)" % PJKEY, T["n"], "num"),
    ("DMs", distinct(ALPER, [(ALROLE, '"DM"')]), T["dmCount"], "num"),
    ("Editor leads", distinct(ALPER, [(ALROLE, '"Editor lead"')]), T["edCount"], "num"),
    ("Live projects per DM", "=$B$%d/MAX(1,$B$%d)" % (WROW, WROW + 4),
     T["active"] / T["dmCount"], "num1"),
    ("Live projects per editor lead", "=$B$%d/MAX(1,$B$%d)" % (WROW, WROW + 5),
     T["active"] / T["edCount"], "num1"),
    ("DM utilisation", "=$B$%d/CapDM" % (WROW + 6),
     T["active"] / T["dmCount"] / SET["capacityPerDM"], "num2"),
    ("Editor lead utilisation", "=$B$%d/CapEd" % (WROW + 7),
     T["active"] / T["edCount"] / SET["capacityPerEditor"], "num2"),
    ("The constraint", '=IF($B$%d>=$B$%d,"editor leads","DMs")' % (WROW + 9, WROW + 8),
     "editor leads", "cell"),
    ("Constraint headcount", "=IF($B$%d>=$B$%d,$B$%d,$B$%d)"
     % (WROW + 9, WROW + 8, WROW + 5, WROW + 4), T["edCount"], "num"),
    ("Constraint load each", "=IF($B$%d>=$B$%d,$B$%d,$B$%d)"
     % (WROW + 9, WROW + 8, WROW + 7, WROW + 6), T["active"] / T["edCount"], "num1"),
    ("Constraint ceiling", "=IF($B$%d>=$B$%d,CapEd,CapDM)" % (WROW + 9, WROW + 8),
     SET["capacityPerEditor"], "num"),
    ("Needed at that ceiling", "=CEILING($B$%d/$B$%d,1)" % (WROW, WROW + 13), 7, "num"),
    ("Book of business", "=SUM(%s)" % PJREV, T["rev"], "money"),
    ("Revenue behind a flag", "=SUMPRODUCT((%s>0)*%s)" % (PJRISK, PJREV), T["riskRev"], "money"),
    ("Rows carrying a flag", '=COUNTIF(%s,">0")' % PJRISK, T["atRisk"], "num"),
    ("Rows with a serious flag", '=COUNTIF(%s,">0")' % ref(prj, PJ.rng("Serious")),
     T["serious"], "num"),
    ("Clients with work", "=SUMPRODUCT(1/COUNTIF(%s,%s))" % (PJKEY, PJKEY),
     T["clientCount"], "num"),
    ("Clients billing", '=COUNTIF(%s,">0")' % RVAMT, CONC["billing"], "num"),
    ("Biggest client's share", "=MAX(%s)/$B$%d*100" % (CBREV, WROW + 15),
     CONC["top1"] * 100, "pct"),
    ("Top three share", "=(LARGE({c},1)+LARGE({c},2)+LARGE({c},3))/$B$%d*100"
     .format(c=CBREV) % (WROW + 15), CONC["top3"] * 100, "pct"),
    ("Effective clients (1 / HHI)", "=1/SUMPRODUCT(({r}/SUM({r}))^2)".format(r=CBREV),
     CONC["effectiveClients"], "num1"),
    ("Delivery team cost", "=$B$%d*CostDM+$B$%d*CostEd" % (WROW + 4, WROW + 5),
     cost_now, "money"),
    ("Contribution", "=$B$%d-$B$%d" % (WROW + 15, WROW + 24), T["rev"] - cost_now, "money"),
    ("Revenue not mapped to a client", '=COUNTIF(%s,"not mapped")' % RVMAP,
     sum(1 for x in D["revenue"] if x["unmapped"]), "num"),
    ("Rows still on an assumed effort", '=COUNTIF(%s,"assumed")' % ref(prj, PJ.rng("Basis")),
     LT["assumed"], "num"),
]
B = {}
for i, (label, formula, val, fmt) in enumerate(dwork):
    rr = WROW + i
    dash.merge_range(rr - 1, 0, rr - 1, 2, label, f["mute"])
    dash.merge_range(rr - 1, 3, rr - 1, 4, "", f[fmt])
    dash.write_formula(rr - 1, 3, formula, f[fmt], val)
    B[label] = "$D$%d" % rr

# the working block writes into E, so fix up the self-references above
# (they were written against column B); rewrite them now that B{} is known.
fixes = {
    "Live projects per DM": "={a}/MAX(1,{b})".format(a=B["Live projects"], b=B["DMs"]),
    "Live projects per editor lead": "={a}/MAX(1,{b})".format(a=B["Live projects"],
                                                              b=B["Editor leads"]),
    "DM utilisation": "={a}/CapDM".format(a=B["Live projects per DM"]),
    "Editor lead utilisation": "={a}/CapEd".format(a=B["Live projects per editor lead"]),
    "The constraint": '=IF({e}>={d},"editor leads","DMs")'.format(
        e=B["Editor lead utilisation"], d=B["DM utilisation"]),
    "Constraint headcount": "=IF({e}>={d},{a},{b})".format(
        e=B["Editor lead utilisation"], d=B["DM utilisation"],
        a=B["Editor leads"], b=B["DMs"]),
    "Constraint load each": "=IF({e}>={d},{a},{b})".format(
        e=B["Editor lead utilisation"], d=B["DM utilisation"],
        a=B["Live projects per editor lead"], b=B["Live projects per DM"]),
    "Constraint ceiling": "=IF({e}>={d},CapEd,CapDM)".format(
        e=B["Editor lead utilisation"], d=B["DM utilisation"]),
    "Needed at that ceiling": "=CEILING({a}/{b},1)".format(
        a=B["Live projects"], b=B["Constraint ceiling"]),
    "Biggest client's share": "=MAX({c})/{b}*100".format(c=CBREV, b=B["Book of business"]),
    "Top three share": "=(LARGE({c},1)+LARGE({c},2)+LARGE({c},3))/{b}*100".format(
        c=CBREV, b=B["Book of business"]),
    "Delivery team cost": "={a}*CostDM+{b}*CostEd".format(a=B["DMs"], b=B["Editor leads"]),
    "Contribution": "={a}-{b}".format(a=B["Book of business"], b=B["Delivery team cost"]),
}
for i, (label, formula, val, fmt) in enumerate(dwork):
    if label in fixes:
        dash.write_formula(WROW - 1 + i, 3, fixes[label], f[fmt], val)

# ------------------------------------------------------------------ verdict
dash.merge_range("A4:O5", "", f["vhot"])
dash.write_formula(
    "A4",
    '=IF({u}<=1,"{t}  Delivery has room. Every role is inside its ceiling; the '
    'heaviest is "&{who}&" at "&TEXT({per},"0.0")&" live projects each against a '
    'ceiling of "&{cap}&".","{w}  "&UPPER(LEFT({who},1))&MID({who},2,99)&" are the constraint. "&{n}&" of '
    'them are carrying "&TEXT({per},"0.0")&" live projects each against a ceiling of '
    '"&{cap}&". Clearing that needs "&{need}&" "&{who}&" {em} "&({need}-{n})&" more '
    'than today.")'.format(
        u="MAX(%s,%s)" % (B["DM utilisation"], B["Editor lead utilisation"]),
        who=B["The constraint"], per=B["Constraint load each"], cap=B["Constraint ceiling"],
        n=B["Constraint headcount"], need=B["Needed at that ceiling"],
        t=TICK, w=WARN, em=EM),
    f["vhot"], "")
dash.set_row(3, 21)
dash.set_row(4, 21)

# ------------------------------------------------------------------- the tiles
dash.merge_range("A7:O7", "THE NUMBERS TODAY", f["band"])
dash.set_row(6, 18)

tile(8, 0, "BOOK OF BUSINESS", "=%s/10000000" % B["Book of business"], T["rev"] / CR,
     '"' + RUPEE + '"0.00" Cr"',
     '="against a target of "&TEXT(TargetCr,"0")&" Cr {e} "&TEXT({b}/10000000/TargetCr*100,"0")'
     '&"% of the way, "&TEXT(TargetCr-{b}/10000000,"0.0")&" Cr to find"'
     .format(b=B["Book of business"], e=EM), "")
tile(8, 3, "LIVE PROJECTS", "=%s" % B["Live projects"], T["active"], "#,##0",
     '="of "&{n}&" rows {e} "&{h}&" parked on hold, "&{u}&" upcoming"'
     .format(n=B["Project rows"], h=B["On hold"], u=B["Upcoming"], e=EM), "")
tile(8, 6, "PROJECTS PER DM", "=%s" % B["Live projects per DM"], T["active"] / T["dmCount"],
     "#,##0.0",
     '="ceiling "&CapDM&" {e} "&IF({u}>1,"over","has room")&" ("&{n}&" DMs)"'
     .format(u=B["DM utilisation"], n=B["DMs"], e=EM), "")
tile(8, 9, "PROJECTS PER EDITOR LEAD", "=%s" % B["Live projects per editor lead"],
     T["active"] / T["edCount"], "#,##0.0",
     '="ceiling "&CapEd&" {e} "&IF({u}>1,TEXT({u},"0.0")&"x over",'
     'IF({u}>0.85,"at the limit","has room"))&" ("&{n}&" of them)"'
     .format(u=B["Editor lead utilisation"], n=B["Editor leads"], e=EM), "", accent=True)
tile(8, 12, "REVENUE BEHIND A FLAG", "=%s/10000000" % B["Revenue behind a flag"],
     T["riskRev"] / CR, '"' + RUPEE + '"0.00" Cr"',
     '=""&{a}&" of "&{n}&" rows carry a flag, "&{s}&" of them serious"'
     .format(a=B["Rows carrying a flag"], n=B["Project rows"],
             s=B["Rows with a serious flag"]), "")

tile(12, 0, "CLIENTS WITH WORK", "=%s" % B["Clients with work"], T["clientCount"], "#,##0",
     '=""&{b}&" of them billing; the rest have no revenue mapped"'
     .format(b=B["Clients billing"]), "")
tile(12, 3, "BIGGEST CLIENT", "=%s" % B["Biggest client's share"], CONC["top1"] * 100,
     '0.0"% of the book"',
     '="the top three take "&TEXT({t},"0.0")&"% between them"'
     .format(t=B["Top three share"]), "")
tile(12, 6, "EFFECTIVE CLIENTS", "=%s" % B["Effective clients (1 / HHI)"],
     CONC["effectiveClients"], "#,##0.0",
     '="the book behaves like this many equal-sized clients"', "")
tile(12, 9, "DELIVERY TEAM COST", "=%s/10000000" % B["Delivery team cost"], cost_now / CR,
     '"' + RUPEE + '"0.00" Cr"',
     '=""&{d}&" DMs and "&{e2}&" editor leads, at the rates on Assumptions"'
     .format(d=B["DMs"], e2=B["Editor leads"]), "")
tile(12, 12, "CONTRIBUTION", "=%s/10000000" % B["Contribution"], (T["rev"] - cost_now) / CR,
     '"' + RUPEE + '"0.00" Cr"',
     '="a margin of "&TEXT({c}/{b}*100,"0")&"% {e} delivery cost only, no overhead"'
     .format(c=B["Contribution"], b=B["Book of business"], e=EM), "")

# ------------------------------------------------------------------- charts
dash.merge_range("A17:O17", "WHERE THE TIME AND THE MONEY GO", f["band"])
dash.set_row(16, 18)

AX = {"num_font": {"size": 9, "name": "Aptos Narrow", "color": INK2},
      "line": {"color": LINE}}
GRID = {"visible": True, "line": {"color": "#EFEFF2"}}


def dress(c, title):
    c.set_title({"name": title,
                 "name_font": {"size": 11, "bold": True, "name": "Aptos Narrow"}})
    c.set_legend({"position": "bottom", "font": {"size": 9, "name": "Aptos Narrow"}})
    c.set_chartarea({"border": {"color": LINE}, "fill": {"color": "#FFFFFF"}})
    c.set_plotarea({"fill": {"color": "#FFFFFF"}})
    c.set_size({"width": 450, "height": 330})
    return c


TOPN = 12
c1 = wb.add_chart({"type": "bar"})
for nm, col, colr in (("Share of the team's time", CB.i("Share of team"), ACCENT),
                      ("Share of the book", CB.i("Share of book"), S3)):
    c1.add_series({"name": nm,
                   "categories": ["Clients", 3, CB.i("Client"), 2 + TOPN, CB.i("Client")],
                   "values": ["Clients", 3, col, 2 + TOPN, col],
                   "fill": {"color": colr}, "border": {"none": True}, "gap": 50})
c1.set_x_axis(dict(AX, major_gridlines=GRID, num_format='0"%"'))
c1.set_y_axis(dict(AX, reverse=True))
dress(c1, "Heaviest clients: time taken against money brought in")
dash.insert_chart("A19", c1)

c2 = wb.add_chart({"type": "pie"})
c2.add_series({
    "name": "Book by service line",
    "categories": ["Service lines", 3, SV.i("Service line"),
                   2 + len(D["categories"]), SV.i("Service line")],
    "values": ["Service lines", 3, SV.i(RUPEE + " Cr"),
               2 + len(D["categories"]), SV.i(RUPEE + " Cr")],
    "points": [{"fill": {"color": c}} for c in (S1, S2, S3, S4, S5, S6, S7, S8)],
    "data_labels": {"percentage": True, "font": {"size": 9, "name": "Aptos Narrow",
                                                 "color": "#FFFFFF", "bold": True}},
})
dress(c2, "The book by service line")
dash.insert_chart("H19", c2)

c3 = wb.add_chart({"type": "column"})
for nm, col, colr in (("Live projects", PP.i("Live"), ACCENT),
                      ("Ceiling", PP.i("Ceiling"), "#D9D9DE")):
    c3.add_series({"name": nm,
                   "categories": ["People", 3, PP.i("Person"), 14, PP.i("Person")],
                   "values": ["People", 3, col, 14, col],
                   "fill": {"color": colr}, "border": {"none": True}, "gap": 40})
c3.set_x_axis(dict(AX))
c3.set_y_axis(dict(AX, major_gridlines=GRID))
dress(c3, "Editor leads and the busiest DMs, against their ceiling")
dash.insert_chart("A37", c3)

c4 = wb.add_chart({"type": "bar"})
c4.add_series({"name": "Revenue",
               "categories": ["Revenue", 3, RV.i("Client"), 2 + TOPN, RV.i("Client")],
               "values": ["Revenue", 3, RV.i(RUPEE + " Cr"), 2 + TOPN, RV.i(RUPEE + " Cr")],
               "fill": {"color": S3}, "border": {"none": True}, "gap": 40,
               "data_labels": {"value": True, "num_format": '0.00',
                               "font": {"size": 8, "name": "Aptos Narrow"}}})
c4.set_x_axis(dict(AX, major_gridlines=GRID))
c4.set_y_axis(dict(AX, reverse=True))
c4.set_legend({"none": True})
dress(c4, "Biggest clients by revenue (" + RUPEE + " Cr)")
dash.insert_chart("H37", c4)

# --------------------------------------------------------------- escalations
dash.merge_range("A56:O56", "THE TEN LOUDEST ESCALATIONS", f["band"])
dash.set_row(55, 18)
heads = [("A57:B57", "Client"), ("C57:D57", "Project"), ("E57:E57", "Score"),
         ("F57:J57", "What is wrong"), ("K57:L57", "Who to call"),
         ("M57:N57", "Last update"), ("O57:O57", RUPEE + " Cr")]
for rng, label in heads:
    fmt = f["thr"] if label in ("Score", RUPEE + " Cr") else f["th"]
    if rng.split(":")[0] == rng.split(":")[1]:
        dash.write(rng.split(":")[0], label, fmt)
    else:
        dash.merge_range(rng, label, fmt)
for i in range(10):
    r = 58 + i
    er = ES.first + i
    dash.merge_range("A%d:B%d" % (r, r), "", f["bold"])
    dash.write_formula("A%d" % r, "=" + ref(esc, ES.c("Client", er)), f["bold"], "")
    dash.merge_range("C%d:D%d" % (r, r), "", f["cell"])
    dash.write_formula("C%d" % r, "=" + ref(esc, ES.c("Project", er)), f["cell"], "")
    dash.write_formula("E%d" % r, "=" + ref(esc, ES.c("Score", er)), f["num1"], "")
    dash.merge_range("F%d:J%d" % (r, r), "", f["cell"])
    dash.write_formula("F%d" % r, "=" + ref(esc, ES.c("What is wrong", er)), f["cell"], "")
    dash.merge_range("K%d:L%d" % (r, r), "", f["cell"])
    dash.write_formula("K%d" % r, "=" + ref(esc, ES.c("Who to call", er)), f["cell"], "")
    dash.merge_range("M%d:N%d" % (r, r), "", f["date"])
    dash.write_formula("M%d" % r, '=IF({c}="","",{c})'.format(
        c=ref(esc, ES.c("Last update", er))), f["date"], "")
    dash.write_formula("O%d" % r, "=" + ref(esc, ES.c(RUPEE + " Cr", er)), f["cr"], "")
    dash.set_row(r - 1, 16)
dash.conditional_format("E58:E67", {"type": "data_bar", "bar_color": "#F3B8B8",
                                    "bar_solid": True, "min_type": "num", "min_value": 0})
dash.merge_range("A69:O70",
                 "The full list, with the blocker text and who else is on the project, "
                 "is on the Escalations tab. Severity drives the order; revenue only "
                 "breaks ties.", f["note"])

dash.merge_range("A72:O73",
                 "Read the tabs left to right: Scenario is where you move the levers, "
                 "Clients and People are the evidence behind this page, Escalations is "
                 "the call list, and Projects, Timeline and Updates are the raw board. "
                 "How to read this explains the arithmetic.", f["note"])
dash.set_first_sheet()
dash.activate()
dash.set_selection("A1")


# ====================================================================== 14. how to read this
rm = sheet("How to read this", tab=INK3,
           title="How to read this workbook",
           sub="Written for whoever opens it cold.")
rm.set_column(0, 0, 3)
rm.set_column(1, 1, 30)
rm.set_column(2, 2, 104)

h = F(font_size=11, bold=True, valign="top")
p = F(font_size=10, font_color=INK2, text_wrap=True, valign="top")
lab = F(font_size=10, bold=True, valign="top", text_wrap=True)

blocks = [
    ("What this is", None,
     "A snapshot of the TFOps board (" + str(T["n"]) + " project rows, "
     + str(len(D["revenue"])) + " billing clients, " + str(len(D["updates"]))
     + " status updates) turned into a spreadsheet you can interrogate. It is not a "
     "picture of the board: the arithmetic came across with the data, so the numbers "
     "recalculate when you change an assumption."),
    ("Shaded cells are inputs", None,
     "Anything on a pale yellow background is yours to change " + EM + " the ceilings "
     "and costs on Assumptions, the levers on Scenario, and the per-project Delivery "
     "effort column on Projects. Everything else is a formula. Nothing here writes back "
     "to the live board."),
    ("The two percentages", None,
     "Share of the team is how much of the delivery team's time a client uses. Share of "
     "the book is how much of the revenue it brings in. Both are percentages of the same "
     "100%, so they can be read straight against each other with no unit in your head. "
     "Balance says the verdict in words. A client on 6% of the team for 0.5% of the book "
     "is the thing to find, and Clients is sorted to put it near the top."),
    ("How delivery load is counted", None,
     "There are no timesheets behind this, so load is estimated, not measured. Each "
     "project is scored for how much work it is " + EM + " Content @ Scale 5, "
     "Personalisation 4, Cinematic 3, Avatar Creative 2, Avatar Simple 1, plus one where "
     "the scope names a four-figure volume. On-hold work counts at a quarter, upcoming at "
     "a half. The score is split between everyone named in that role, so a project with "
     "two DMs weighs half as much on each. All " + str(LT["assumed"]) + " rows are still "
     "on the assumed figure; set the Delivery effort column on Projects to replace a "
     "guess with what the work really costs."),
    ("How revenue is attributed", None,
     "The revenue sheet books a number once per client, but a client can have several "
     "project rows. A client's amount is split evenly across its projects, then again "
     "across the people named on each. That is why every breakdown " + EM + " by pod, by "
     "DM, by service line " + EM + " adds back to the same total, and why a per-project "
     "revenue figure is an attribution, not an invoice."),
    ("Capacity counts live work only", None,
     "Utilisation is measured against live projects, not the whole book. The "
     + str(T["hold"]) + " on-hold rows are reported separately and only land on someone's "
     "plate when the restart lever on Scenario moves. Parked projects are real, but they "
     "are not what the team is doing this week, so counting them would overstate the load."),
    ("Where the numbers are still soft", None,
     "Three things to hold lightly. " + str(sum(1 for x in D['revenue'] if x['unmapped']))
     + " clients are billed somewhere the source sheet never tied to a client key, so they "
     "show as not mapped rather than " + RUPEE + "0 " + EM + " zero would read as free "
     "work. Only " + str(len(dated)) + " of " + str(T["n"]) + " rows arrived with a usable "
     "date, so the Timeline is a third of a Gantt and says so. And every effort score is "
     "an assumption until someone who knows overrides it."),
    ("Live versus fixed", None,
     "Rule of thumb: numbers recalculate, prose does not. Counts, money, shares, "
     "utilisation, the verdict on the front page and the two time-based flags (overdue, "
     "stale) are all formulas. The written risk reasons, the escalation scores and the "
     "lists of names were evaluated by the board when the file was built, on "
     + D["updatedAt"][:10] + "."),
    ("Refreshing it", None,
     "Two commands against the repo, with the board's data in place:\n"
     "    node tools/export-board.mjs board-export.json\n"
     "    python tools/build-xlsx.py board-export.json TFOps-CEO-Dashboard.xlsx\n"
     "The exporter imports the same compute.js the web app runs, so the spreadsheet and "
     "the board cannot drift apart."),
    ("This file holds the client book", None,
     "Client names, revenue, staff names and every status update are in here. It is the "
     "same data the repo deliberately keeps out of git. Send it the way you would send "
     "the revenue sheet itself."),
]
r = 4
for title, _, text in blocks:
    rm.write(r, 1, title, lab)
    rm.write(r, 2, text, p)
    lines = max(2, int(len(text) / 96) + text.count("\n") * 2 + 1)
    rm.set_row(r, lines * 12.5)
    r += 2

rm.write(r + 1, 1, "Tabs", f["eyebrow"])
r += 2
tabnotes = [
    ("Dashboard", "The one page. Verdict, ten numbers, four charts, the ten loudest escalations."),
    ("Scenario", "Hire, lose, restart parked work, raise prices, lose a client. Before and after."),
    ("Clients", "Who eats the delivery team and who pays for it. Sorted heaviest first."),
    ("People", "Every DM and editor lead, their load, and whether they are over the ceiling."),
    ("Escalations", "Every project carrying a flag, worst first, with who to call."),
    ("Projects", "All " + str(T["n"]) + " rows with the board's arithmetic attached."),
    ("Timeline", "A month grid for the rows that have dates, and an honest list of the rest."),
    ("Pods", "The three pods rolled up."),
    ("Service lines", "What the team makes, by revenue and by effort."),
    ("Revenue", "The book as the revenue sheet books it, one line per client."),
    ("Updates", "All " + str(len(D["updates"])) + " status updates, newest first."),
    ("Assumptions", "Ceilings, costs, target, and the effort weights. Everything is editable."),
    ("Allocations", "The support table the rollups add up. One row per person, per project."),
]
for name, note in tabnotes:
    rm.write(r, 1, name, F(font_size=10, bold=True))
    rm.write(r, 2, note, F(font_size=10, font_color=INK2))
    r += 1

wb.close()
print("wrote %s" % OUT)
print("  %d projects, %d clients, %d revenue rows, %d updates, %d people"
      % (T["n"], len(D["clients"]), len(D["revenue"]), len(D["updates"]), len(people)))
