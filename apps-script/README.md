# ເກັບຂໍ້ມູນໃນ Google Sheet (ຫຼາຍຄົນເຊື່ອມຕໍ່ກັນ)

Sheet 1 ໃບ = 1 ບໍລິສັດ. `Code.gs` ເປັນຜູ້ເຝົ້າປະຕູ: ກວດລະຫັດພະນັກງານ + PIN 4 ຕົວ (ແບບກົດແປ້ນຕົວເລກ ຄືກັບ ST POS) ແລະ ກວດສິດທຸກຄັ້ງ. **ຢ່າແບ່ງປັນ Sheet ໃຫ້ໃຜ** (ຄົນແກ້ Sheet ໄດ້ເຫັນທຸກຢ່າງ).

## ຕັ້ງຄ່າ (~5 ນາທີ)
1. ສ້າງ Google Sheet ເປົ່າ → **Extensions → Apps Script** → ລຶບໂຄ້ດເດີມ → ວາງໂຄ້ດຈາກ `apps-script/Code.gs` (ປຸ່ມ Raw ໃນ GitHub) → Save.
2. ⚙ **Project Settings → Script Properties → Add**: `SIGNUP_CODE` = ລະຫັດລັບຂອງເຈົ້າ.
3. **Deploy → New deployment → Web app** · Execute as: **Me** · Who has access: **Anyone** → Deploy → ອະນຸຍາດສິດ (ຖ້າຂຶ້ນ "unverified" ກົດ Advanced → Go to… ) → ຄັດລອກ **Web app URL** (ລົງທ້າຍ `/exec`).
4. ເປີດແອັບ → ແຖບ **Google Sheet** → ວາງ URL → **ສ້າງບໍລິສັດໃໝ່**: ໃສ່ SIGNUP_CODE, ຊື່ບໍລິສັດ, ຊື່ **Admin**, PIN **Super admin** (ເຈົ້າຂອງລະບົບ · ລະຫັດ `ST-000` · ເຈົ້າຈະເຂົ້າດ້ວຍບັນຊີນີ້) ແລະ PIN ເລີ່ມຕົ້ນຂອງ **Admin** (ລະຫັດ `ST-001` · ຕ້ອງປ່ຽນ PIN ເທື່ອທຳອິດ).
   - **Super admin**: ຕັ້ງ/ຣີເຊັດ PIN ຂອງ Admin, ກຳນົດ Admin ໄດ້; Admin ແກ້ ຫຼື ປິດບັນຊີ Super admin ບໍ່ໄດ້.
   - **Admin**: ບໍລິຫານບໍລິສັດ (ພະນັກງານ, ເງິນເດືອນ, ກົດເກນ…).
   - ເລີ່ມໃໝ່ທັງໝົດ: ໃນ Apps Script ເລືອກຟັງຊັນ `wipeEverything` ແລ້ວກົດ **Run** (ລຶບຂໍ້ມູນທັງໝົດ ຍົກເລີກບໍ່ໄດ້).
5. ເພີ່ມພະນັກງານ → **ສິດ & ການອະນຸມັດ** → **ອອກ PIN** → ສົ່ງ **ລິ້ງຕັ້ງຄ່າມືຖື** + PIN ຊົ່ວຄາວໃຫ້ແຕ່ລະຄົນ.

ອັບເດດໂຄ້ດ: ວາງທັບ → **Deploy → Manage deployments → ✏ → New version**.

## ເຂົ້າລະບົບ ແລະ ສິດ ແບບ ST POS
- **ເຂົ້າລະບົບ:** ເປີດແອັບ → ກົດ **ການ໌ດຊື່** ຂອງຕົນເອງ → ກົດ **PIN 4 ຕົວ** (ເຂົ້າເອງເມື່ອຄົບ). PIN ຜິດ 5 ເທື່ອ ລັອກບັນຊີນັ້ນ 5 ນາທີ.
- **ໝາຍເຫດຄວາມປອດໄພ:** ໜ້າເຂົ້າລະບົບສະແດງ **ຊື່ + ລະຫັດ + ບົດບາດ** ຂອງຄົນທີ່ມີບັນຊີ ໃຫ້ທຸກຄົນທີ່ມີລິ້ງເຫັນ (ຄືກັບ ST POS) ແຕ່ບໍ່ມີເງິນເດືອນ ຫຼື ຂໍ້ມູນລັບ. ຢ່າສົ່ງລິ້ງໃຫ້ຄົນນອກບໍລິສັດ.
- **ສິດລາຍຄົນ:** ໜ້າ **ສິດ & ການອະນຸມັດ** → ປຸ່ມ **ສິດ** ຂ້າງຊື່ → ຕິກ ໜ້າທີ່ເຂົ້າໄດ້ / ເຮັດຫຍັງໄດ້ / ຂອບເຂດຂໍ້ມູນ (ມີປ້າຍ "ປັບແລ້ວ" ແລະ ປຸ່ມ "ຄືນຄ່າຕາມບົດບາດ"). Admin ຕິກໃຫ້ໄດ້ສະເພາະສິດທີ່ຕົນເອງມີ ແລະ ຕິກໃຫ້ຕົນເອງບໍ່ໄດ້. Super admin ແລະ Admin ມີທຸກສິດສະເໝີ.
- **ສິດຂອງບົດບາດ (Super admin):** ຕາຕະລາງ **ສິດຂອງແຕ່ລະບົດບາດ** ໃນໜ້າດຽວກັນ — Super admin ແກ້ສິດເລີ່ມຕົ້ນຂອງ ຫົວໜ້າ / ບັນຊີ / ຜູ້ກວດສອບ ໄດ້ ແລະ ມີຜົນກັບທຸກຄົນໃນບົດບາດນັ້ນ.
- **ໃສ່ PIN ອະນຸມັດແທນ:** ຄົນທີ່ບໍ່ມີສິດເຮັດບາງຢ່າງ (ເຊັ່ນ ປິດງວດເງິນເດືອນ, ຕັດສິນສະແກນ) ກົດ **ຂໍ PIN ອະນຸມັດ** → ຄົນທີ່ມີສິດ "ອະນຸມັດແທນ" ເລືອກຊື່ຕົນເອງ ແລ້ວໃສ່ PIN → ລາຍການເຮັດໄດ້ຄັ້ງດຽວ (ໝົດອາຍຸໃນ 2 ນາທີ). ລະບົບບັນທຶກວ່າໃຜຂໍ ແລະ ໃຜອະນຸມັດ. ການຈັດການບັນຊີ ແລະ ສິດ ໃຫ້ຢືມບໍ່ໄດ້.

## ຂໍ້ຄວນຮູ້
- ເງິນເດືອນ/ໃບໜ້າ/ສະລິບ ເຫັນສະເພາະຄົນທີ່ກ່ຽວຂ້ອງ; ບົດບາດປ່ຽນໄດ້ສະເພາະເຈົ້າຂອງ; PIN ຜິດ 5 ເທື່ອ ລັອກ 5 ນາທີ.
- ຊ້າກວ່າ Supabase (~1–3 ວິນາທີ/ຄຳສັ່ງ, ຂໍ້ມູນໃໝ່ຂຶ້ນພາຍໃນ ~45 ວິນາທີ) ແລະ ມີໂຄຕ້າ Google. ເໝາະບໍລິສັດນ້ອຍ (≤ ~50 ຄົນ).
- ຢ່າແກ້/ລຶບແຖວໃນ Sheet ດ້ວຍມື.

## Looking up PINs (Admin and Super admin)

An Admin or Super admin can look at a person's PIN and set a new one (Access page → "ເບິ່ງ / ແກ້ PIN"). To make that possible a PIN is also kept **sealed** next to its hash: scrambled with a secret key, `PIN_KEY`, that the script makes on first use and keeps in **Script Properties** (never in the sheet). Anyone who can open the spreadsheet sees only scrambled text in the `pinSealed` column; only this script can unscramble it, and only for an Admin or Super admin. An Admin cannot look at another Admin's or the Super admin's PIN. Every look at someone else's PIN is written to the audit log (`pin-reveal`).

- A PIN set before this feature has no sealed copy; it becomes viewable the next time its owner signs in, or when an Admin sets a new PIN.
- Whoever can edit the Apps Script project or its Script Properties can read `PIN_KEY` and so unscramble PINs. Keep that access to the company owner.
- Deleting `PIN_KEY` makes every sealed PIN unreadable (people still sign in normally; sealed copies are made again at their next sign-in).

## Admin needs the Super admin for some things

In a company that has a Super admin, an **Admin** (not the Super admin) needs the Super admin PIN behind these, and the database refuses them otherwise (error code `needsuper`):

- deleting any record for good (people, leave, clock-ins, advances, pay items, payroll months, requests, shifts, branches);
- changing a person pay, allowance or bank account;
- closing **or reopening** a payroll month;
- editing a clock-in after the fact (its kind, time, branch or owner; review decisions and photo purges stay free).

The web app opens the Super admin PIN card by itself when that happens and repeats the action with the approval attached (one approval, 120 seconds, the sheet records "Admin <- Super admin"). The Super admin never needs approval. A company with no Super admin behaves as before.

Every deletion writes the whole record to the audit log (`record-delete`). A person can be deleted only when nothing was ever recorded for them (use "close account" otherwise); their login and pay rows go with them. The "Manage records" page (Admin and Super admin only) lists and edits or deletes every kind of record.
