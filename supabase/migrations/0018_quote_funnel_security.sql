-- 0018: 修掉 0017 的一個權限漏洞（2026-09-13）
-- PostgreSQL 15 之後，view 預設是 security_invoker = off，也就是以「view 擁有者」的身分讀底層表，
-- 會繞過 quote_log 的 RLS。這表示任何登入的使用者都能透過 quote_funnel 看到「全部人」的報價統計。
-- 打開 security_invoker 之後，view 以呼叫者身分讀表，RLS 才會生效：
-- 一般使用者只看得到自己的報價，管理員看得到全部。
alter view public.quote_funnel set (security_invoker = on);
