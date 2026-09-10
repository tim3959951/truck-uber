# GitHub Actions CI（尚未啟用）

`github-actions-ci.yml` 是完整的 CI 設定（typecheck、Postgres 上跑 supabase/tests、兩個 web build）。

目前這個 repo 的 Personal Access Token 沒有 **Workflows** 權限，所以檔案先放在這裡。
要啟用有兩種方式（擇一）：

1. 在 GitHub 網頁把 `ci/github-actions-ci.yml` 複製到 `.github/workflows/ci.yml`（Add file → Create new file）。
2. 到 GitHub → Settings → Developer settings → Fine-grained tokens，把 token 的
   Repository permissions 加上 **Workflows: Read and write**，之後由 Claude 移回正確路徑。

Netlify 的自動部署不需要這個檔案，它自己會從原始碼建置。
