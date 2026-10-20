@echo off
title Senat Votes - Mise a jour des donnees
chcp 65001 > nul
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Python est introuvable dans le PATH. Installez-le depuis https://www.python.org/
    pause
    exit /b 1
)

if not exist "backend\.env.local" (
    echo [ERREUR] backend\.env.local est absent. Copiez backend\.env.example et renseignez DATABASE_URL.
    pause
    exit /b 1
)

echo [INFO] Installation des dependances...
python -m pip install --quiet --disable-pip-version-check -r backend\requirements.txt
if errorlevel 1 (
    echo [ERREUR] Echec de l'installation des dependances.
    pause
    exit /b 1
)

if /i "%~1"=="--commit" (
    echo [INFO] Import des donnees du Senat : senateurs, scrutins, votes individuels. Les changements seront ENREGISTRES.
) else (
    echo [INFO] Simulation ^(dry run^) : les donnees sont telechargees et comparees a la base, puis tout est annule.
    echo [INFO] Pour enregistrer les changements : refresh_data.bat --commit
)

cd /d "%~dp0backend"
python -m importers all %*
if errorlevel 1 (
    echo [ERREUR] L'import a echoue. Voir les messages ci-dessus.
    pause
    exit /b 1
)

if /i not "%~1"=="--commit" (
    echo [INFO] Simulation terminee, rien n'a ete ecrit. Pour enregistrer : refresh_data.bat --commit
)
pause
