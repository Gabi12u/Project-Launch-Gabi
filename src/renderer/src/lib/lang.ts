import { setLanguage } from '@shared/i18n'

// Imported first in main.tsx so every other module already sees the right
// language, including strings built when a module is first evaluated.
setLanguage(window.gabi.language)
// index.html ships lang="de"; without this, screen readers read English text
// with German pronunciation.
document.documentElement.lang = window.gabi.language
