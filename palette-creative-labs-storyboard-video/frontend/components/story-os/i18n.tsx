"use client"

// Tiny self-contained EN/KR dictionary for the Palette OS story UI.
// Language follows the Palette OS host automatically: `lang` is derived from
// `usePlatform().language` (the OS's language preference) and re-renders
// whenever the host changes it. There is no manual toggle — switching the OS
// language switches the app, the same way theme-provider.tsx follows
// `usePlatform().colorMode` for light/dark.

import * as React from "react"
import { usePlatform, normalizePaletteLanguage } from "@palettelab/sdk"

export type PosLang = "en" | "kr"

const DICT = {
  // Toolbar / chrome
  appName: ["Storyboard Video Maker", "Storyboard Video Maker"],
  navLibrary: ["Library", "라이브러리"],
  navBrandKit: ["Brand Kit", "브랜드 키트"],
  navHome: ["Home", "홈"],
  stageStoryboarding: ["storyboarding", "storyboarding"],
  stageAnimating: ["animating", "animating"],
  stagePublishReady: ["publish ready", "publish ready"],
  stepBrief: ["Brief", "Brief"],
  stepStoryboard: ["Storyboard", "Storyboard"],
  stepAnimate: ["Animate", "Animate"],
  stepPublish: ["Publish", "Publish"],
  scenesN: ["{n} scenes", "{n}개 씬"],

  // Home
  heroTitle1: ["Turn any story", "어떤 이야기든"],
  heroTitle2: ["into a video", "영상으로 만들어요"],
  heroSub: [
    "Brief → Storyboard → Animate → Publish. One pipeline, scene by scene.",
    "Brief → Storyboard → Animate → Publish. 하나의 파이프라인으로 씬별 제작.",
  ],
  promptPh: ["What story should we turn into video?", "어떤 이야기를 영상으로 만들까요?"],
  attach: ["Add reference images", "레퍼런스 이미지 추가"],
  attachHint: [
    "Characters, objects or styles the video should stay faithful to (max {n})",
    "영상이 따라야 할 캐릭터·사물·스타일 (최대 {n}장)",
  ],
  analyzing: ["analyzing…", "분석 중…"],
  analyzeFailed: ["Couldn't analyze the reference", "레퍼런스 분석에 실패했어요"],
  duration: ["Duration", "길이"],
  ratio: ["Ratio", "비율"],
  quality: ["Quality", "화질"],
  quality720Sub: ["fast + cheap", "빠르고 저렴"],
  quality1080Sub: ["crisp master", "선명한 마스터"],
  audio: ["Audio", "오디오"],
  audioGenerated: ["generated", "생성 오디오"],
  audioGeneratedSub: ["model-native ambience & sound", "모델이 만드는 자연스러운 사운드"],
  audioSilent: ["silent", "무음"],
  audioSilentSub: ["no audio track", "오디오 트랙 없음"],
  audioMusic: ["music only", "음악만"],
  audioMusicSub: ["ElevenLabs Music track, no voice", "ElevenLabs Music 트랙, 음성 없음"],
  audioVoiceoverMusic: ["voiceover + music", "내레이션 + 음악"],
  audioVoiceoverMusicSub: ["eleven_v3 narration over ElevenLabs Music", "ElevenLabs Music 위에 eleven_v3 내레이션"],

  // Audio settings dialog (music/voiceover modes)
  audioSettingsMusicTitle: ["Music settings", "음악 설정"],
  audioSettingsVoiceoverTitle: ["Voiceover + music settings", "내레이션 + 음악 설정"],
  audioSettingsHint: [
    "Optional — leave anything blank to use a sensible default.",
    "선택사항이에요 — 비워두면 기본값을 사용해요.",
  ],
  musicPromptLabel: ["Music style", "음악 스타일"],
  musicPromptPlaceholder: ["e.g. warm acoustic guitar, gentle and hopeful", "예: 따뜻한 어쿠스틱 기타, 잔잔하고 희망찬 느낌"],
  narrationTextLabel: ["Narration script", "내레이션 대본"],
  narrationTextPlaceholder: ["Leave blank to narrate the story as planned", "비워두면 계획된 스토리를 그대로 내레이션해요"],
  narrationVoiceLabel: ["Narration voice", "내레이션 음성"],
  narrationLanguageLabel: ["Narration language", "내레이션 언어"],
  langEnglish: ["English", "영어"],
  langKorean: ["Korean", "한국어"],
  includeCaptions: ["Include captions", "자막 포함"],
  captionsAutoNote: [
    "Captions are timed automatically from the narration and burned into the video.",
    "자막은 내레이션에 맞춰 자동으로 타이밍이 맞춰져 영상에 삽입돼요.",
  ],
  save: ["Save", "저장"],
  contBridgeSub: ["each cut lands on the next scene's start frame", "각 컷이 다음 씬의 시작 프레임으로 이어져요"],
  contCinematicSub: ["multi-angle shot list inside every clip", "클립마다 멀티 앵글 샷 구성"],
  contIndependentSub: ["each clip moves freely", "클립마다 자유로운 움직임"],
  imageModelChip: ["◇ {name}", "◇ {name}"],
  videoModelChip: ["◆ {name}", "◆ {name}"],
  start: ["Start pipeline", "파이프라인 시작"],
  planning: ["Planning your story…", "스토리를 구성하고 있어요…"],
  planningInProgress: [
    "Still planning this story — it'll be ready in a moment.",
    "아직 스토리를 구성하고 있어요 — 곧 준비돼요.",
  ],
  planFailed: ["Story planning failed", "스토리 구성에 실패했어요"],
  emptyPrompt: ["Describe your story first", "먼저 이야기를 입력해 주세요"],
  recent: ["Recent runs", "최근 작업"],
  recentHint: ["pick up any project at its current stage", "어느 단계에서든 프로젝트를 이어서 작업할 수 있어요"],
  noRuns: ["No runs yet — your videos will appear here.", "아직 작업이 없어요 — 만든 영상이 여기에 표시돼요."],

  // Brief view
  briefIdea: ["Idea", "아이디어"],
  briefConcept: ["Concept / Story", "컨셉 / 스토리"],
  briefSettings: ["Settings", "설정"],
  briefReuse: ["Reuse this brief", "이 브리프 재사용"],
  briefReuseHint: [
    "Start a new run on Home with this idea pre-filled",
    "이 아이디어가 채워진 상태로 홈에서 새 작업을 시작해요",
  ],
  briefEditNote: [
    "Edits apply from the next generation onward (images, motion prompts, clips).",
    "수정 사항은 다음 생성(이미지·모션 프롬프트·클립)부터 적용돼요.",
  ],
  briefRegenerate: ["Regenerate", "다시 생성"],
  briefRegenHint: [
    "Idea, concept, duration, ratio or scene count changed — regenerate to rebuild the whole run.",
    "아이디어·컨셉·길이·비율·씬 수가 바뀌었어요 — 전체를 다시 만들려면 재생성하세요.",
  ],
  briefRegenerating: ["Regenerating…", "다시 생성 중…"],

  // Stage navigation
  startOver: ["Start over", "새로 시작"],
  toAnimate: ["Go to Animate", "Animate로 이동"],
  toPublish: ["Go to Publish", "Publish로 이동"],
  toAnimateLocked: [
    "Available once scene images are done and motion prompts are written",
    "씬 이미지가 완성되고 모션 프롬프트가 작성되면 이동할 수 있어요",
  ],
  toPublishLocked: [
    "Available once all clips are generated",
    "모든 클립이 생성되면 이동할 수 있어요",
  ],

  // Statuses
  stLive: ["Live", "완성"],
  stRendering: ["Rendering", "생성 중"],
  stDraft: ["Draft", "초안"],
  stInProgress: ["In progress", "진행 중"],
  stPlanning: ["Planning…", "기획 중…"],
  stPlanFailed: ["Plan failed", "기획 실패"],
  retryPlan: ["Retry", "다시 시도"],

  // Storyboard
  beatMap: ["Scenes", "씬 목록"],
  sceneN: ["Scene {n}", "씬 {n}"],
  imagePromptLabel: ["Image prompt", "이미지 프롬프트"],
  imagePromptHint: ["click to edit — describes this scene's key frame", "클릭해서 수정 — 이 씬의 키 프레임 묘사"],
  generateImages: ["Generate {n} images", "이미지 {n}장 생성"],
  regenerateChangedImages: ["Regenerate", "재생성"],
  regenerateNoChanges: ["Edit a scene's prompt to enable this", "씬 프롬프트를 수정하면 활성화돼요"],
  refsMaxReached: ["Maximum {n} images", "최대 {n}장"],
  generateImageOne: ["Generate", "생성"],
  generateImageScene: ["Generate image", "이미지 생성"],
  continueBtn: ["Continue", "계속"],
  promptStale: ["Prompt or model changed — regenerate to apply", "프롬프트 또는 모델이 바뀌었어요 — 재생성해 적용하세요"],
  promptStaleShort: ["prompt changed", "프롬프트 변경됨"],
  imagesProgress: ["Generating images {done}/{total}", "이미지 생성 중 {done}/{total}"],
  regenImage: ["Regenerate image", "이미지 재생성"],
  regen: ["Regen", "재생성"],
  retry: ["Retry", "다시 시도"],
  storySummary: ["Story", "스토리"],
  styleBible: ["Style bible", "스타일 바이블"],
  references: ["References", "레퍼런스"],
  referencesHint: [
    "The cast this video stays faithful to — add or remove reference images, then regenerate.",
    "이 영상이 따라야 할 출연진 — 레퍼런스 이미지를 추가·삭제한 뒤 재생성하세요.",
  ],
  addReference: ["Add reference", "레퍼런스 추가"],
  remove: ["Remove", "삭제"],
  viewLarge: ["View large", "크게 보기"],
  masterRef: ["Style anchor", "스타일 앵커"],
  masterRefHint: [
    "Generate or upload anchor images — every scene is drawn from them so characters and look stay consistent.",
    "앵커 이미지를 생성하거나 업로드하세요 — 모든 씬이 이를 기준으로 그려져 캐릭터와 룩이 일정하게 유지돼요.",
  ],
  masterGenerate: ["Generate anchor", "앵커 생성"],
  masterUpload: ["Upload", "업로드"],
  masterFailed: ["Style anchor failed", "스타일 앵커 생성에 실패했어요"],
  llmModel: ["Writer LLM", "작문 LLM"],
  imageModel: ["Image model", "이미지 모델"],
  waitingImages: ["Waiting for scene images…", "씬 이미지를 기다리는 중…"],
  writingPrompts: ["Writing motion prompts…", "모션 프롬프트 작성 중…"],
  writePromptsRetry: ["Retry motion prompts", "모션 프롬프트 재시도"],
  imageFailedHint: ["Some images failed — retry them to continue.", "일부 이미지가 실패했어요 — 다시 시도해 주세요."],

  // Animate
  motionPromptLabel: ["Motion prompt", "모션 프롬프트"],
  motionPromptHint: ["how this shot moves — edit before generating", "이 샷의 움직임 — 생성 전에 수정하세요"],
  continuity: ["Continuity", "연결 방식"],
  contBridge: ["Seamless cuts", "이음새 없는 컷"],
  contCinematic: ["Cinematic multi-shot", "시네마틱 멀티샷"],
  contIndependent: ["Independent shots", "독립 샷"],
  videoModel: ["Video model", "비디오 모델"],
  generateVideos: ["Generate {n} clips", "클립 {n}개 생성"],
  videosProgress: ["Rendering clips {done}/{total}", "클립 생성 중 {done}/{total}"],
  videoFailedHint: ["Some clips failed — retry them to continue.", "일부 클립이 실패했어요 — 다시 시도해 주세요."],
  retryClip: ["Retry clip", "클립 다시 생성"],
  retryAllClips: ["Retry all failed clips", "실패한 클립 전체 재시도"],
  regenClip: ["Regenerate clip", "클립 재생성"],
  addScene: ["Add scene", "씬 추가"],
  addingScene: ["Adding…", "추가하는 중…"],
  moveSceneLeft: ["Move scene earlier", "씬을 앞으로 이동"],
  moveSceneRight: ["Move scene later", "씬을 뒤로 이동"],
  timeline: ["Timeline", "타임라인"],
  timelineNote: ["Click a clip to inspect it.", "클립을 클릭해 선택하세요."],
  playFromHere: ["Play", "재생"],
  pauseVideo: ["Pause", "일시정지"],
  clipDone: ["done", "완료"],
  clipWaiting: ["waiting", "대기"],
  clipRendering: ["rendering", "생성 중"],
  clipFailed: ["failed", "실패"],
  autoMergeNote: [
    "Clips merge into the final video — with audio and captions if enabled — once you click Go to Publish.",
    "'Publish로 이동'을 클릭하면 클립이 (설정된 오디오·자막과 함께) 최종 영상으로 합쳐져요.",
  ],

  // Inspector tabs — Prompt editor vs. Agent chat (one at a time)
  tabPrompt: ["Prompt", "프롬프트"],
  tabAgent: ["Agent", "에이전트"],
  tabChat: ["Chat", "채팅"],

  // Scene chat
  chatTitleSB: ["Storyboard Agent", "스토리보드 에이전트"],
  chatTitleAN: ["Animate Agent", "애니메이트 에이전트"],
  chatHeaderHintGenerate: ["/generate", "/생성"],
  chatHeaderHintEdit: ["/edit", "/편집"],
  chatPh: ["Describe a change for this scene…", "이 씬에 적용할 수정을 입력하세요…"],
  chatEmptyState: [
    "Ask a question, request a change, or type @ to pick a scene.",
    "질문을 하거나 수정을 요청해 보세요. @를 입력하면 씬을 선택할 수 있어요.",
  ],
  chatComingSoon: [
    "Chat editing isn't connected yet — coming soon. For now, edit the prompt above and regenerate.",
    "챗 편집은 아직 연결되지 않았어요 — 곧 제공돼요. 지금은 위의 프롬프트를 수정하고 재생성해 주세요.",
  ],
  chatThinking: ["Thinking…", "생각하는 중…"],
  chatEmptyReply: ["Done!", "완료했어요!"],
  chatJumpedToScene: ["Jumped to {n} — that's the scene the change applies to.", "{n}로 이동했어요 — 변경 사항이 적용되는 씬이에요."],
  chatNeedsPrevScenes: [
    "I can only generate {n}'s image after the scenes before it are done. Want me to generate the pending scenes first, one by one?",
    "{n}의 이미지는 그 이전 씬들이 먼저 완료되어야 생성할 수 있어요. 대기 중인 이전 씬들을 먼저 하나씩 생성할까요?",
  ],
  chatGeneratingPending: [
    "Generating the pending scenes now, one by one — each using the previous scene's image for consistency.",
    "대기 중인 씬들을 하나씩 생성할게요 — 일관성을 위해 이전 씬의 이미지를 참고해요.",
  ],
  chatLlmPickerTitle: ["Chat LLM: {n} — click to switch", "챗 LLM: {n} — 클릭하여 변경"],
  noScenesFound: ["No matching scenes", "일치하는 씬이 없어요"],

  // Publish
  merging: ["Merging scenes into the final video…", "씬을 최종 영상으로 합치는 중…"],
  mergeFailed: ["Merge failed", "병합에 실패했어요"],
  mergeRetry: ["Retry merge", "병합 다시 시도"],
  mergeRegenerate: ["Regenerate final video", "최종 영상 다시 생성"],
  mergeRegenerating: ["Regenerating…", "다시 생성하는 중…"],
  finalVideo: ["Final video", "최종 영상"],
  publishTo: ["Publish to", "게시할 곳"],
  publishYoutube: ["YouTube Shorts", "유튜브 쇼츠"],
  connectYoutube: ["Connect YouTube", "유튜브 연결"],
  connectedAs: ["Connected as {name}", "{name}(으)로 연결됨"],
  youtubeAccount: ["your channel", "내 채널"],
  disconnect: ["Disconnect", "연결 해제"],
  publishToYoutube: ["Publish to YouTube Shorts", "유튜브 쇼츠에 게시"],
  publishing: ["Publishing…", "게시 중…"],
  viewOnYoutube: ["View on YouTube", "유튜브에서 보기"],
  loadingEllipsis: ["Loading…", "불러오는 중…"],
  youtubeConnected: ["YouTube connected", "유튜브가 연결되었어요"],
  publishInstagram: ["Instagram Reels", "인스타그램 릴스"],
  connectInstagram: ["Connect Instagram", "인스타그램 연결"],
  instagramAccount: ["your account", "내 계정"],
  publishToInstagram: ["Publish to Instagram Reels", "인스타그램 릴스에 게시"],
  viewOnInstagram: ["View on Instagram", "인스타그램에서 보기"],
  instagramConnected: ["Instagram connected", "인스타그램이 연결되었어요"],
  publishTiktok: ["TikTok", "틱톡"],
  connectTiktok: ["Connect TikTok", "틱톡 연결"],
  tiktokAccount: ["your account", "내 계정"],
  publishToTiktok: ["Publish to TikTok", "틱톡에 게시"],
  tiktokPublished: ["Published to TikTok", "틱톡에 게시했어요"],
  tiktokConnected: ["TikTok connected", "틱톡이 연결되었어요"],
  download: ["Download", "다운로드"],
  startNew: ["New video", "새 영상 만들기"],
  backToAnimate: ["Back to Animate", "Animate로 돌아가기"],
  summaryStoryboard: ["STORYBOARD", "STORYBOARD"],
  summaryAnimate: ["ANIMATE", "ANIMATE"],
  summaryModels: ["MODELS", "MODELS"],

  // Library
  library: ["Library", "라이브러리"],
  librarySub: ["all your story videos", "모든 스토리 영상"],
  filterAll: ["All", "전체"],
  deleteRun: ["Delete", "삭제"],
  deleteRunTitle: ["Delete this project", "프로젝트 삭제"],
  deleteConfirm: ["Delete this run? Generated media stays in storage.", "이 작업을 삭제할까요? 생성된 미디어는 저장소에 남아요."],
  open: ["Open", "열기"],

  // Brand Kit
  bkTitle: ["Brand Kit", "브랜드 키트"],
  bkSub: ["assets ready to drop into any run", "영상 제작에 바로 쓰는 에셋"],
  bkUpload: ["+ Upload asset", "+ 에셋 업로드"],
  bkUploading: ["Uploading…", "업로드 중…"],
  bkAnalyzing: ["Categorizing…", "분류 중…"],
  bkCatAll: ["All", "전체"],
  bkCatLogo: ["Logos", "로고"],
  bkCatCharacter: ["Characters", "캐릭터"],
  bkCatObject: ["Products & objects", "제품·사물"],
  bkCatColor: ["Colors", "컬러 팔레트"],
  bkCatType: ["Type", "타이포그래피"],
  bkCatMotion: ["Motion presets", "모션 프리셋"],
  bkCatOther: ["Other", "기타"],
  bkEmpty: ["No assets in this category yet", "아직 이 카테고리에 에셋이 없어요"],
  bkEmptyAll: [
    "No Brand Kit assets yet — upload a logo, character sheet, palette, or anything else your videos should stay consistent with.",
    "아직 브랜드 키트 에셋이 없어요 — 로고, 캐릭터 시트, 컬러 팔레트 등 영상에 일관되게 반영할 에셋을 업로드해 보세요.",
  ],
  bkAnalyzeFailed: ["Couldn't categorize this asset", "에셋을 분류하지 못했어요"],
  bkUse: ["Use", "사용"],
  bkSelectedCount: ["{n} selected", "{n}개 선택됨"],
  bkUseSelected: ["Use {n}", "{n}개 사용"],
  bkUsedToast: [
    "Added {n} to your reference images on Home",
    "홈 화면의 레퍼런스 이미지에 {n}개를 추가했어요",
  ],
  bkDeleteAsset: ["Remove asset", "에셋 삭제"],
  bkDeleteAssetTitle: ["Delete this asset", "이 에셋 삭제"],
  bkDeleteAssetConfirm: [
    "Delete this Brand Kit asset? This can't be undone.",
    "이 브랜드 키트 에셋을 삭제할까요? 이 작업은 되돌릴 수 없어요.",
  ],

  // Storyboard — per-scene delete
  sceneOptions: ["Scene options", "장면 옵션"],
  deleteScene: ["Delete", "삭제"],
  deleteSceneTitle: ["Delete scene", "장면 삭제"],
  deleteSceneConfirm: [
    "This scene will be deleted permanently. This action cannot be undone.",
    "이 장면은 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없어요.",
  ],
  cantDeleteLastScene: ["A run needs at least one scene", "최소 한 개의 장면이 필요해요"],
  cancel: ["Cancel", "취소"],
} as const

export type PosKey = keyof typeof DICT

interface PosI18n {
  lang: PosLang
  t: (key: PosKey, vars?: Record<string, string | number>) => string
}

const Ctx = React.createContext<PosI18n>({
  lang: "en",
  t: (k) => String(k),
})

export function PosI18nProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const lang: PosLang = normalizePaletteLanguage(platform.language, "en") === "ko" ? "kr" : "en"
  const t = React.useCallback(
    (key: PosKey, vars?: Record<string, string | number>) => {
      let s: string = DICT[key][lang === "kr" ? 1 : 0]
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replaceAll(`{${k}}`, String(v))
        }
      }
      return s
    },
    [lang],
  )
  const value = React.useMemo(() => ({ lang, t }), [lang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePosT() {
  return React.useContext(Ctx)
}
