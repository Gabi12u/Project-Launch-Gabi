import { setLanguage } from '@shared/i18n'

// Imported first in main.tsx so every other module already sees the right
// language, including strings built when a module is first evaluated.
setLanguage(window.gabi.language)
