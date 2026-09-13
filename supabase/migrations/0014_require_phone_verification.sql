-- 0014: 正式開啟手機簡訊驗證
-- 2026-09-13。Twilio 帳號已儲值並通過 Trust Hub 實名認證（Primary Compliance Profile），
-- 可以發給任何號碼，所以把「下單／送出資格審核前必須完成手機驗證」打開。
-- 簡訊走 Twilio Verify（Supabase auth: sms_provider = twilio_verify），不需要自有門號。
update public.pricing_config set require_phone_verification = true where id = 1;
alter table public.pricing_config alter column require_phone_verification set default true;
