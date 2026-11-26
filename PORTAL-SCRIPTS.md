# JCW portal scripts (Tampermonkey)

All browser scripts that work with the **UOP portal** (portal.uop.edu.pk) for Jinnah College for Women.
They are kept here so they can be installed again on any laptop.

**Install page:** https://asimalatif.github.io/jcms/scripts.html (App → Admin home → Portal scripts)

## New laptop: set everything up again

1. Install Google Chrome (or Edge) and the **Tampermonkey** extension.
2. In Chrome open `chrome://extensions`, switch on **Developer mode** (Tampermonkey needs it in new Chrome versions), and in Tampermonkey's details turn on **Allow user scripts**.
3. Open https://asimalatif.github.io/jcms/scripts.html and press **Install** on every script you use. Tampermonkey opens its install page: press **Install**.
4. Log in to the UOP portal and open **Student → Students**.
5. For the scripts that talk to the JCMS app (Portal Sync, New Session List, Enrollment Manager): the first time, paste the **sync key** (JCMS app → College → UOP portal sync → Get sync key). When Tampermonkey asks to connect to script.google.com, press **Always allow**.
6. Admission Quota Manager scripts (Lookup Bridge, Status Check) need nothing else: they wait until the Admission Quota Manager asks them.

The sync key is **not** stored in these files (this repository is public). Keep it only in the app.

## The scripts

| File | Version | Works with | Writes on the portal? |
|---|---|---|---|
| `jcw-portal-sync.user.js` | 1.12 | JCMS app | No (read only) |
| `jcw-new-session-list.user.js` | 2.1 | JCMS app (Seat settings) | No (read only) |
| `uop-enrollment-manager.user.js` | 3.7 | JCMS app / CSV | **Yes** (Enrollment#, Reg#, Program, Class, Section, marks) |
| `uop-lookup-bridge.user.js` | 2.1 | Admission Quota Manager | No (read only) |
| `uop-status-check.user.js` | 1.0 | Admission Quota Manager | No (read only) |

### 1. JCW Portal Sync (`jcw-portal-sync.user.js`)
Runs on Student → Students. Reads every Jinnah College student (Enrolled, Cancelled, Migrated, Disenrolled, Transfer) and sends them to JCMS (`portal_import`).
- **Quick sync** (1–2 min): the student list only; also reads fee challans, marks and details of *new* enrolled students not yet in the strength sheet (`portal_known`).
- **Full sync** (30–60 min, can be resumed after a logout): details of every enrolled student: DOB, contact, email, photo, HQ (Hafiz-e-Quran), quota, matric board / year / roll no / marks, fee challans (P-/U- amounts), FEE PAID DATE (first paid challan above Rs 3,000), First Challan Date (v1.12), 1st and 2nd year subjects, and every other field of the edit page as "Portal …" columns.
- **Details of students who left**: the same details for cancelled / migrated / disenrolled / transferred students of this year's two batches.
- Fills **only empty cells** of Transform-ALL-COLLEGE-STRENGTH. Students who left go to Left Students only when you press **Move N / Add N to Left Students** (`portal_left`).
- **Auto quick sync every 20 min** while the tab is open. The app's "Sync with the portal now" opens the portal with `#jcw-sync` and the script starts by itself and closes the window when done.
- Progress is kept in IndexedDB `JCW_PORTAL_SYNC`.

### 2. JCW New Session List (`jcw-new-session-list.user.js`)
Runs on Student → Students. Makes the next session's 1st Year list as Excel in the exact Transform-ALL-COLLEGE-STRENGTH columns (44 columns), one sheet each for F.A, Pre-Engineering, FCS, Pre-Medical (S), (M), (E), plus "Seats & merit" and "Check these".
- Panel: Session, Enroll# year, first S.No, last date of admission, seats, subsidized fee (60000), Evening on/off, fee date corrections, batch.
- **From the app**: reads the seats from JCMS → Admissions → Seat settings (`portal_seats`, sync key); read again every time step 2 is pressed. Falls back to the Seats box.
- All admission rules: Aggregate = (obtained + 20 if HQ) × 100 ÷ total; MeritNo per sheet and quota; Age-wise (older first); fee decides (≤ 60,000 subsidized, 120,000 self-finance, only challans > Rs 3,000); late students only lose a seat when seats are short; 85 Open subsidized seats; shared pools; UoP Employee always subsidized (red if < 50%); yellow / orange / red Quota cells; Enroll# ranges PMS 1–203, PMM 204–1099, PME 1100–1999, PE 2001–2099, FA 2101–2299, FCS 2301–2399.
- See the JCMS manual, sections 20A and 20C. Progress in IndexedDB `JCW_NEW_LIST`.

### 3. UOP VC – Enrollment Manager (`uop-enrollment-manager.user.js`)
Runs on Student → Students. **Changes the portal**: on each student's edit page (`/Student/NewStudent/{id}`) it sets Enrollment#, Reg# (= Enrollment#), Program, Class, Section and, when given, matric / O-Level marks.
- **⬇ Load wrong values from JCW app** (`portal_fixlist`, sync key) or a CSV (columns PORTAL ID, Enroll#, Program, Class, Section, Student Name, Father Name).
- Tick list; ⚠ rows where the portal's name / father is different are unticked (may be another student); "✕ never change this student".
- **🔍 Check only** first (nothing saved), then **▶ Update**. Fast check reads pages without opening them; only students that need a change are opened (hidden frames, or popup window). Verify after save; Skip already done; ⬇ Report (CSV).
- Safety: never saves when the page's student name does not match. Opened from the app with `#uopem-fix` it loads and checks by itself.

### 4. UOP Lookup Bridge (`uop-lookup-bridge.user.js`) — Admission Quota Manager
Runs only in the window opened by the Admission Quota Manager's **Connect portal** button (`window.name = uopLookupBridge`). Goes to Student → Students, loads the whole student list and answers the app's messages: `search` (name / father / Enrollment# / Reg#), `detail` (DOB, email, contact, address, Hafiz, photo, institution, quota, matric marks, board, 1st-year subjects, fee challans), `reload`, `ping`. Read only.
- v2.1: `quotaOf` moved inside the script (in v2.0 it was outside and stopped with "sp is not defined", so the quota stayed empty).

### 5. UOP Status Check (`uop-status-check.user.js`) — Admission Quota Manager
Waits silently in every portal tab. When the Admission Quota Manager's **Check portal status** asks (`uopStatusReq` from script.google.com / googleusercontent.com), it reads the Cancelled, Migrated, Disenrolled and Enrolled lists of Jinnah College (institute 1212) and sends them back (`uopStatusList`). Lists are re-read if older than 5 minutes. Read only.

## Updating a script
Change the file here (or ask Claude), raise `@version`, merge. On each laptop: Tampermonkey → the script → or simply press **Install** again on the scripts page.
