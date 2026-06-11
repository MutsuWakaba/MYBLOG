$path1 = [System.Environment]::GetEnvironmentVariable("Path","Machine")
$path2 = [System.Environment]::GetEnvironmentVariable("Path","User")
$env:Path = "$path1;$path2"
pnpm dev
