import type { TranslationResources } from "@palettelab/sdk"

export const translations = {
  en: {
    kicker: "Palette DB App",
    title: "Org Notes",
    copy: "Built for {{name}}. This app uses a Python backend and the Palette SDK database session exposed as ctx.db.",
    placeholder: "New note...",
    add: "Add Note",
    saving: "Saving",
    loading: "Loading notes...",
    empty: "No notes yet.",
    loadError: "Could not load notes",
    saveError: "Could not save note",
    saved: "Note saved",
  },
  ko: {
    kicker: "Palette DB 앱",
    title: "조직 노트",
    copy: "{{name}}님을 위해 생성되었습니다. 이 앱은 Python 백엔드와 ctx.db로 제공되는 Palette SDK 데이터베이스 세션을 사용합니다.",
    placeholder: "새 노트...",
    add: "노트 추가",
    saving: "저장 중",
    loading: "노트를 불러오는 중...",
    empty: "아직 노트가 없습니다.",
    loadError: "노트를 불러올 수 없습니다",
    saveError: "노트를 저장할 수 없습니다",
    saved: "노트가 저장되었습니다",
  },
} satisfies TranslationResources
