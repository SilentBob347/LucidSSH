; Не пересоздавать ярлык на рабочем столе, если пользователь удалил его вручную
; после предыдущей установки. У electron-builder есть свой встроенный механизм
; для этого (KeepShortcuts в реестре при allowToChangeInstallationDirectory),
; но на практике при установке новой версии поверх старой (без деинсталляции)
; ярлык всё равно пересоздавался — см. обсуждение 10.07.2026. Вместо того чтобы
; разбираться, почему встроенный механизм не срабатывает в этом сценарии,
; сделан независимый: своё состояние в реестре под собственным ключом
; приложения, не завязанное на внутреннюю логику electron-builder.
;
; customInit выполняется в .onInit, ДО того как electron-builder создаст/
; пересоздаст ярлык — здесь фиксируем, существовал ли он до этого прогона.
; customInstall выполняется ПОСЛЕ встроенной логики electron-builder — здесь
; удаляем то, что она могла успеть пересоздать, если пользователь ранее уже
; убирал ярлык сам.

!macro customInit
  ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $R7 "1"
  ${else}
    StrCpy $R7 "0"
  ${endif}
  ReadRegStr $R8 HKCU "Software\LucidSSH" "DesktopShortcutEverCreated"
  ${if} $R7 == "0"
  ${andIf} $R8 == "1"
    ; Ярлыка нет сейчас, но раньше он точно создавался — значит, удалён
    ; намеренно. Просим customInstall не восстанавливать его на этом прогоне.
    WriteRegStr HKCU "Software\LucidSSH" "SkipDesktopShortcut" "1"
  ${else}
    WriteRegStr HKCU "Software\LucidSSH" "SkipDesktopShortcut" "0"
  ${endif}
!macroend

!macro customInstall
  ReadRegStr $R7 HKCU "Software\LucidSSH" "SkipDesktopShortcut"
  ${if} $R7 == "1"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
  WriteRegStr HKCU "Software\LucidSSH" "DesktopShortcutEverCreated" "1"
  DeleteRegValue HKCU "Software\LucidSSH" "SkipDesktopShortcut"
!macroend

!macro customUnInstall
  ; Деинсталлятор запускается не только при настоящем удалении: при каждой
  ; переустановке/автообновлении electron-builder тихо гоняет старый
  ; деинсталлятор с флагом --updated (installUtil.nsh: "always pass --updated
  ; flag"). Чистить состояние можно ТОЛЬКО при настоящем удалении, иначе:
  ; 1) сотрём SkipDesktopShortcut, который новый инсталлятор записал в
  ;    customInit за мгновение до этого — механизм сломается через версию;
  ; 2) при автообновлении удалили бы ярлык, который встроенная логика
  ;    (--keep-shortcuts) сознательно сохраняет.
  ; Сам ярлык при настоящем удалении встроенный деинсталлятор удаляет и без
  ; нас (uninstaller.nsh, блок ifNot isKeepShortcuts) — дублировать не нужно.
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\LucidSSH"
  ${endIf}
!macroend
