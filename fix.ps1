$path1 = [System.Environment]::GetEnvironmentVariable("Path","Machine")
$path2 = [System.Environment]::GetEnvironmentVariable("Path","User")
$env:Path = "$path1;$path2"
pnpm add react@18.3.1 react-dom@18.3.1 @types/react@18.3.12 @types/react-dom@18.3.1
