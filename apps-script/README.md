# ເກັບຂໍ້ມູນໃນ Google Sheet (ຫຼາຍຄົນເຊື່ອມຕໍ່ກັນ)

Sheet 1 ໃບ = 1 ບໍລິສັດ. `Code.gs` ເປັນຜູ້ເຝົ້າປະຕູ: ກວດລະຫັດພະນັກງານ + PIN 6 ຕົວ ແລະ ກວດສິດທຸກຄັ້ງ. **ຢ່າແບ່ງປັນ Sheet ໃຫ້ໃຜ** (ຄົນແກ້ Sheet ໄດ້ເຫັນທຸກຢ່າງ).

## ຕັ້ງຄ່າ (~5 ນາທີ)
1. ສ້າງ Google Sheet ເປົ່າ → **Extensions → Apps Script** → ລຶບໂຄ້ດເດີມ → ວາງໂຄ້ດຈາກ `apps-script/Code.gs` (ປຸ່ມ Raw ໃນ GitHub) → Save.
2. ⚙ **Project Settings → Script Properties → Add**: `SIGNUP_CODE` = ລະຫັດລັບຂອງເຈົ້າ.
3. **Deploy → New deployment → Web app** · Execute as: **Me** · Who has access: **Anyone** → Deploy → ອະນຸຍາດສິດ (ຖ້າຂຶ້ນ "unverified" ກົດ Advanced → Go to… ) → ຄັດລອກ **Web app URL** (ລົງທ້າຍ `/exec`).
4. ແອັບ → **🌐 ເຂົ້າບໍລິສັດອອນລາຍ** → ແຖບ **Google Sheet** → ວາງ URL → **ສ້າງບໍລິສັດໃໝ່** (ໃສ່ SIGNUP_CODE, ຊື່ບໍລິສັດ, ຊື່ເຈົ້າຂອງ, PIN 6 ຕົວ).
5. ເພີ່ມພະນັກງານ → **ສິດ & ການອະນຸມັດ** → **ອອກ PIN** → ສົ່ງ **ລິ້ງຕັ້ງຄ່າມືຖື** + PIN ຊົ່ວຄາວໃຫ້ແຕ່ລະຄົນ.

ອັບເດດໂຄ້ດ: ວາງທັບ → **Deploy → Manage deployments → ✏ → New version**.

## ຂໍ້ຄວນຮູ້
- ເງິນເດືອນ/ໃບໜ້າ/ສະລິບ ເຫັນສະເພາະຄົນທີ່ກ່ຽວຂ້ອງ; ບົດບາດປ່ຽນໄດ້ສະເພາະເຈົ້າຂອງ; PIN ຜິດ 5 ເທື່ອ ລັອກ 5 ນາທີ.
- ຊ້າກວ່າ Supabase (~1–3 ວິນາທີ/ຄຳສັ່ງ, ຂໍ້ມູນໃໝ່ຂຶ້ນພາຍໃນ ~45 ວິນາທີ) ແລະ ມີໂຄຕ້າ Google. ເໝາະບໍລິສັດນ້ອຍ (≤ ~50 ຄົນ).
- ຢ່າແກ້/ລຶບແຖວໃນ Sheet ດ້ວຍມື.
