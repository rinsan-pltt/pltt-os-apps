"use client"

// Tiny self-contained EN/KR/JA dictionary for the Palette OS story UI.
// Language follows the Palette OS host automatically: `lang` is derived from
// `usePlatform().language` (the OS's language preference) and re-renders
// whenever the host changes it. There is no manual toggle — switching the OS
// language switches the app, the same way theme-provider.tsx follows
// `usePlatform().colorMode` for light/dark.

import * as React from "react"
import { usePlatform, normalizePaletteLanguage } from "@palettelab/sdk"

export type PosLang = "en" | "kr" | "ja"

const DICT = {
  // Toolbar / chrome
  appName: ["Storyboard Video Maker", "Storyboard Video Maker", "Storyboard Video Maker"],
  navLibrary: ["Library", "라이브러리", "ライブラリ"],
  navBrandKit: ["Brand Kit", "브랜드 키트", "ブランドキット"],
  navHome: ["Home", "홈", "ホーム"],
  stageStoryboarding: ["storyboarding", "storyboarding", "storyboarding"],
  stageAnimating: ["animating", "animating", "animating"],
  stagePublishReady: ["publish ready", "publish ready", "publish ready"],
  stepBrief: ["Brief", "Brief", "Brief"],
  stepStoryboard: ["Storyboard", "Storyboard", "Storyboard"],
  stepAnimate: ["Animate", "Animate", "Animate"],
  stepPublish: ["Publish", "Publish", "Publish"],
  scenesN: ["{n} scenes", "{n}개 씬", "{n}シーン"],

  // Home
  heroTitle1: ["Turn any story", "어떤 이야기든", "どんなストーリーも"],
  heroTitle2: ["into a video", "영상으로 만들어요", "動画にしよう"],
  heroSub: [
    "Brief → Storyboard → Animate → Publish. One pipeline, scene by scene.",
    "Brief → Storyboard → Animate → Publish. 하나의 파이프라인으로 씬별 제작.",
    "Brief → Storyboard → Animate → Publish。ひとつのパイプラインで、シーンごとに制作。",
  ],
  promptPh: ["What story should we turn into video?", "어떤 이야기를 영상으로 만들까요?", "どんなストーリーを動画にしますか？"],
  attach: ["Add reference images", "레퍼런스 이미지 추가", "参照画像を追加"],
  attachHint: [
    "Characters, objects or styles the video should stay faithful to (max {n})",
    "영상이 따라야 할 캐릭터·사물·스타일 (최대 {n}장)",
    "動画で忠実に再現したいキャラクター・物・スタイル（最大{n}枚）",
  ],
  analyzing: ["analyzing…", "분석 중…", "分析中…"],
  analyzeFailed: ["Couldn't analyze the reference", "레퍼런스 분석에 실패했어요", "参照画像を分析できませんでした"],
  duration: ["Duration", "길이", "長さ"],
  ratio: ["Ratio", "비율", "比率"],
  quality: ["Quality", "화질", "画質"],
  quality720Sub: ["fast + cheap", "빠르고 저렴", "高速・低コスト"],
  quality1080Sub: ["crisp master", "선명한 마스터", "高精細マスター"],
  audio: ["Audio", "오디오", "オーディオ"],
  audioGenerated: ["generated", "생성 오디오", "自動生成"],
  audioGeneratedSub: ["model-native ambience & sound", "모델이 만드는 자연스러운 사운드", "モデルが生成する環境音・効果音"],
  audioSilent: ["silent", "무음", "無音"],
  audioSilentSub: ["no audio track", "오디오 트랙 없음", "オーディオトラックなし"],
  audioMusic: ["music only", "음악만", "音楽のみ"],
  audioMusicSub: ["ElevenLabs Music track, no voice", "ElevenLabs Music 트랙, 음성 없음", "ElevenLabs Music のトラック、ナレーションなし"],
  audioVoiceoverMusic: ["voiceover + music", "내레이션 + 음악", "ナレーション＋音楽"],
  audioVoiceoverMusicSub: ["eleven_v3 narration over ElevenLabs Music", "ElevenLabs Music 위에 eleven_v3 내레이션", "ElevenLabs Music に eleven_v3 のナレーションを重ねます"],

  // Audio settings dialog (music/voiceover modes)
  audioSettingsMusicTitle: ["Music settings", "음악 설정", "音楽の設定"],
  audioSettingsVoiceoverTitle: ["Voiceover + music settings", "내레이션 + 음악 설정", "ナレーション＋音楽の設定"],
  audioSettingsHint: [
    "Optional — leave anything blank to use a sensible default.",
    "선택사항이에요 — 비워두면 기본값을 사용해요.",
    "任意です — 空欄のままにすると適切なデフォルト値が使われます。",
  ],
  musicPromptLabel: ["Music style", "음악 스타일", "音楽のスタイル"],
  musicPromptPlaceholder: ["e.g. warm acoustic guitar, gentle and hopeful", "예: 따뜻한 어쿠스틱 기타, 잔잔하고 희망찬 느낌", "例：温かみのあるアコースティックギター、穏やかで希望に満ちた雰囲気"],
  narrationTextLabel: ["Narration script", "내레이션 대본", "ナレーション原稿"],
  narrationTextPlaceholder: ["Leave blank to narrate the story as planned", "비워두면 계획된 스토리를 그대로 내레이션해요", "空欄のままにすると、構成どおりのストーリーをナレーションします"],
  narrationVoiceLabel: ["Narration voice", "내레이션 음성", "ナレーションの声"],
  narrationLanguageLabel: ["Narration language", "내레이션 언어", "ナレーションの言語"],
  langEnglish: ["English", "영어", "英語"],
  langKorean: ["Korean", "한국어", "韓国語"],
  includeCaptions: ["Include captions", "자막 포함", "字幕を入れる"],
  captionsAutoNote: [
    "Captions are timed automatically from the narration and burned into the video.",
    "자막은 내레이션에 맞춰 자동으로 타이밍이 맞춰져 영상에 삽입돼요.",
    "字幕はナレーションに合わせて自動でタイミング調整され、動画に焼き込まれます。",
  ],
  save: ["Save", "저장", "保存"],
  contBridgeSub: ["each cut lands on the next scene's start frame", "각 컷이 다음 씬의 시작 프레임으로 이어져요", "各カットが次のシーンの開始フレームにつながります"],
  contCinematicSub: ["multi-angle shot list inside every clip", "클립마다 멀티 앵글 샷 구성", "クリップごとにマルチアングルのショット構成"],
  contIndependentSub: ["each clip moves freely", "클립마다 자유로운 움직임", "クリップごとに自由な動き"],
  imageModelChip: ["◇ {name}", "◇ {name}", "◇ {name}"],
  videoModelChip: ["◆ {name}", "◆ {name}", "◆ {name}"],
  start: ["Start pipeline", "파이프라인 시작", "パイプラインを開始"],
  planning: ["Planning your story…", "스토리를 구성하고 있어요…", "ストーリーを構成しています…"],
  planningInProgress: [
    "Still planning this story — it'll be ready in a moment.",
    "아직 스토리를 구성하고 있어요 — 곧 준비돼요.",
    "ストーリーを構成中です — まもなく準備できます。",
  ],
  planFailed: ["Story planning failed", "스토리 구성에 실패했어요", "ストーリーの構成に失敗しました"],
  emptyPrompt: ["Describe your story first", "먼저 이야기를 입력해 주세요", "まずストーリーを入力してください"],
  recent: ["Recent runs", "최근 작업", "最近の制作"],
  recentHint: ["pick up any project at its current stage", "어느 단계에서든 프로젝트를 이어서 작업할 수 있어요", "どの段階からでもプロジェクトを再開できます"],
  noRuns: ["No runs yet — your videos will appear here.", "아직 작업이 없어요 — 만든 영상이 여기에 표시돼요.", "まだ制作はありません — 作成した動画はここに表示されます。"],

  // Brief view
  briefIdea: ["Idea", "아이디어", "アイデア"],
  briefConcept: ["Concept / Story", "컨셉 / 스토리", "コンセプト / ストーリー"],
  briefSettings: ["Settings", "설정", "設定"],
  briefReuse: ["Reuse this brief", "이 브리프 재사용", "このブリーフを再利用"],
  briefReuseHint: [
    "Start a new run on Home with this idea pre-filled",
    "이 아이디어가 채워진 상태로 홈에서 새 작업을 시작해요",
    "このアイデアを入力した状態でホームから新しい制作を開始します",
  ],
  briefEditNote: [
    "Edits apply from the next generation onward (images, motion prompts, clips).",
    "수정 사항은 다음 생성(이미지·모션 프롬프트·클립)부터 적용돼요.",
    "変更は次回の生成（画像・モーションプロンプト・クリップ）から反映されます。",
  ],
  briefRegenerate: ["Regenerate", "다시 생성", "再生成"],
  briefRegenHint: [
    "Idea, concept, duration, ratio or scene count changed — regenerate to rebuild the whole run.",
    "아이디어·컨셉·길이·비율·씬 수가 바뀌었어요 — 전체를 다시 만들려면 재생성하세요.",
    "アイデア・コンセプト・長さ・比率・シーン数が変更されました — 全体を作り直すには再生成してください。",
  ],
  briefRegenerating: ["Regenerating…", "다시 생성 중…", "再生成中…"],

  // Stage navigation
  startOver: ["Start over", "새로 시작", "最初からやり直す"],
  toAnimate: ["Go to Animate", "Animate로 이동", "Animate へ進む"],
  toPublish: ["Go to Publish", "Publish로 이동", "Publish へ進む"],
  toAnimateLocked: [
    "Available once scene images are done and motion prompts are written",
    "씬 이미지가 완성되고 모션 프롬프트가 작성되면 이동할 수 있어요",
    "シーン画像が完成し、モーションプロンプトが作成されると進めます",
  ],
  toPublishLocked: [
    "Available once all clips are generated",
    "모든 클립이 생성되면 이동할 수 있어요",
    "すべてのクリップが生成されると進めます",
  ],

  // Statuses
  stLive: ["Live", "완성", "完成"],
  stRendering: ["Rendering", "생성 중", "生成中"],
  stDraft: ["Draft", "초안", "下書き"],
  stInProgress: ["In progress", "진행 중", "進行中"],
  stPlanning: ["Planning…", "기획 중…", "構成中…"],
  stPlanFailed: ["Plan failed", "기획 실패", "構成に失敗"],
  retryPlan: ["Retry", "다시 시도", "再試行"],

  // Storyboard
  beatMap: ["Scenes", "씬 목록", "シーン一覧"],
  sceneN: ["Scene {n}", "씬 {n}", "シーン{n}"],
  imagePromptLabel: ["Image prompt", "이미지 프롬프트", "画像プロンプト"],
  imagePromptHint: ["click to edit — describes this scene's key frame", "클릭해서 수정 — 이 씬의 키 프레임 묘사", "クリックして編集 — このシーンのキーフレームを描写します"],
  generateImages: ["Generate {n} images", "이미지 {n}장 생성", "画像を{n}枚生成"],
  regenerateChangedImages: ["Regenerate", "재생성", "再生成"],
  regenerateNoChanges: ["Edit a scene's prompt to enable this", "씬 프롬프트를 수정하면 활성화돼요", "シーンのプロンプトを編集すると有効になります"],
  refsMaxReached: ["Maximum {n} images", "최대 {n}장", "最大{n}枚"],
  generateImageOne: ["Generate", "생성", "生成"],
  generateImageScene: ["Generate image", "이미지 생성", "画像を生成"],
  continueBtn: ["Continue", "계속", "続ける"],
  promptStale: ["Prompt or model changed — regenerate to apply", "프롬프트 또는 모델이 바뀌었어요 — 재생성해 적용하세요", "プロンプトまたはモデルが変更されました — 反映するには再生成してください"],
  promptStaleShort: ["prompt changed", "프롬프트 변경됨", "プロンプト変更あり"],
  imagesProgress: ["Generating images {done}/{total}", "이미지 생성 중 {done}/{total}", "画像を生成中 {done}/{total}"],
  regenImage: ["Regenerate image", "이미지 재생성", "画像を再生成"],
  regen: ["Regen", "재생성", "再生成"],
  retry: ["Retry", "다시 시도", "再試行"],
  storySummary: ["Story", "스토리", "ストーリー"],
  styleBible: ["Style bible", "스타일 바이블", "スタイルバイブル"],
  references: ["References", "레퍼런스", "参照画像"],
  referencesHint: [
    "The cast this video stays faithful to — add or remove reference images, then regenerate.",
    "이 영상이 따라야 할 출연진 — 레퍼런스 이미지를 추가·삭제한 뒤 재생성하세요.",
    "この動画で忠実に再現するキャスト — 参照画像を追加・削除してから再生成してください。",
  ],
  addReference: ["Add reference", "레퍼런스 추가", "参照画像を追加"],
  remove: ["Remove", "삭제", "削除"],
  viewLarge: ["View large", "크게 보기", "拡大表示"],
  masterRef: ["Style anchor", "스타일 앵커", "スタイルアンカー"],
  masterRefHint: [
    "Generate or upload anchor images — every scene is drawn from them so characters and look stay consistent.",
    "앵커 이미지를 생성하거나 업로드하세요 — 모든 씬이 이를 기준으로 그려져 캐릭터와 룩이 일정하게 유지돼요.",
    "アンカー画像を生成またはアップロードしてください — すべてのシーンがこれを基準に描かれるため、キャラクターとルックが統一されます。",
  ],
  masterGenerate: ["Generate anchor", "앵커 생성", "アンカーを生成"],
  masterUpload: ["Upload", "업로드", "アップロード"],
  masterFailed: ["Style anchor failed", "스타일 앵커 생성에 실패했어요", "スタイルアンカーの生成に失敗しました"],
  llmModel: ["Writer LLM", "작문 LLM", "ライター LLM"],
  imageModel: ["Image model", "이미지 모델", "画像モデル"],
  waitingImages: ["Waiting for scene images…", "씬 이미지를 기다리는 중…", "シーン画像を待っています…"],
  writingPrompts: ["Writing motion prompts…", "모션 프롬프트 작성 중…", "モーションプロンプトを作成中…"],
  writePromptsRetry: ["Retry motion prompts", "모션 프롬프트 재시도", "モーションプロンプトを再試行"],
  imageFailedHint: ["Some images failed — retry them to continue.", "일부 이미지가 실패했어요 — 다시 시도해 주세요.", "一部の画像の生成に失敗しました — 再試行して続けてください。"],

  // Animate
  motionPromptLabel: ["Motion prompt", "모션 프롬프트", "モーションプロンプト"],
  motionPromptHint: ["how this shot moves — edit before generating", "이 샷의 움직임 — 생성 전에 수정하세요", "このショットの動き — 生成前に編集できます"],
  continuity: ["Continuity", "연결 방식", "つなぎ方"],
  contBridge: ["Seamless cuts", "이음새 없는 컷", "シームレスなカット"],
  contCinematic: ["Cinematic multi-shot", "시네마틱 멀티샷", "シネマティック・マルチショット"],
  contIndependent: ["Independent shots", "독립 샷", "独立したショット"],
  videoModel: ["Video model", "비디오 모델", "動画モデル"],
  generateVideos: ["Generate {n} clips", "클립 {n}개 생성", "クリップを{n}本生成"],
  videosProgress: ["Rendering clips {done}/{total}", "클립 생성 중 {done}/{total}", "クリップを生成中 {done}/{total}"],
  videoFailedHint: ["Some clips failed — retry them to continue.", "일부 클립이 실패했어요 — 다시 시도해 주세요.", "一部のクリップの生成に失敗しました — 再試行して続けてください。"],
  retryClip: ["Retry clip", "클립 다시 생성", "クリップを再試行"],
  retryAllClips: ["Retry all failed clips", "실패한 클립 전체 재시도", "失敗したクリップをすべて再試行"],
  regenClip: ["Regenerate clip", "클립 재생성", "クリップを再生成"],
  addScene: ["Add scene", "씬 추가", "シーンを追加"],
  addingScene: ["Adding…", "추가하는 중…", "追加中…"],
  moveSceneLeft: ["Move scene earlier", "씬을 앞으로 이동", "シーンを前へ移動"],
  moveSceneRight: ["Move scene later", "씬을 뒤로 이동", "シーンを後ろへ移動"],
  timeline: ["Timeline", "타임라인", "タイムライン"],
  timelineNote: ["Click a clip to inspect it.", "클립을 클릭해 선택하세요.", "クリップをクリックして確認できます。"],
  playFromHere: ["Play", "재생", "再生"],
  pauseVideo: ["Pause", "일시정지", "一時停止"],
  clipDone: ["done", "완료", "完了"],
  clipWaiting: ["waiting", "대기", "待機中"],
  clipRendering: ["rendering", "생성 중", "生成中"],
  clipFailed: ["failed", "실패", "失敗"],
  autoMergeNote: [
    "Clips merge into the final video — with audio and captions if enabled — once you click Go to Publish.",
    "'Publish로 이동'을 클릭하면 클립이 (설정된 오디오·자막과 함께) 최종 영상으로 합쳐져요.",
    "「Publish へ進む」をクリックすると、クリップが（有効な場合はオーディオ・字幕とともに）最終動画に結合されます。",
  ],

  // Inspector tabs — Prompt editor vs. Agent chat (one at a time)
  tabPrompt: ["Prompt", "프롬프트", "プロンプト"],
  tabAgent: ["Agent", "에이전트", "エージェント"],
  tabChat: ["Chat", "채팅", "チャット"],

  // Scene chat
  chatTitleSB: ["Storyboard Agent", "스토리보드 에이전트", "ストーリーボードエージェント"],
  chatTitleAN: ["Animate Agent", "애니메이트 에이전트", "アニメートエージェント"],
  chatHeaderHintGenerate: ["/generate", "/생성", "/生成"],
  chatHeaderHintEdit: ["/edit", "/편집", "/編集"],
  chatPh: ["Describe a change for this scene…", "이 씬에 적용할 수정을 입력하세요…", "このシーンへの変更内容を入力…"],
  chatEmptyState: [
    "Ask a question, request a change, or type @ to pick a scene.",
    "질문을 하거나 수정을 요청해 보세요. @를 입력하면 씬을 선택할 수 있어요.",
    "質問や変更のリクエストをどうぞ。@ を入力するとシーンを選択できます。",
  ],
  chatComingSoon: [
    "Chat editing isn't connected yet — coming soon. For now, edit the prompt above and regenerate.",
    "챗 편집은 아직 연결되지 않았어요 — 곧 제공돼요. 지금은 위의 프롬프트를 수정하고 재생성해 주세요.",
    "チャット編集はまだ接続されていません — 近日公開予定です。今は上のプロンプトを編集して再生成してください。",
  ],
  chatThinking: ["Thinking…", "생각하는 중…", "考え中…"],
  chatEmptyReply: ["Done!", "완료했어요!", "完了しました！"],
  chatJumpedToScene: ["Jumped to {n} — that's the scene the change applies to.", "{n}로 이동했어요 — 변경 사항이 적용되는 씬이에요.", "{n}に移動しました — 変更が適用されるシーンです。"],
  chatNeedsPrevScenes: [
    "I can only generate {n}'s image after the scenes before it are done. Want me to generate the pending scenes first, one by one?",
    "{n}의 이미지는 그 이전 씬들이 먼저 완료되어야 생성할 수 있어요. 대기 중인 이전 씬들을 먼저 하나씩 생성할까요?",
    "{n}の画像は、それより前のシーンが完了してから生成できます。待機中のシーンを先に1つずつ生成しましょうか？",
  ],
  chatGeneratingPending: [
    "Generating the pending scenes now, one by one — each using the previous scene's image for consistency.",
    "대기 중인 씬들을 하나씩 생성할게요 — 일관성을 위해 이전 씬의 이미지를 참고해요.",
    "待機中のシーンを1つずつ生成します — 一貫性を保つため、前のシーンの画像を参照します。",
  ],
  chatLlmPickerTitle: ["Chat LLM: {n} — click to switch", "챗 LLM: {n} — 클릭하여 변경", "チャット LLM：{n} — クリックして切り替え"],
  noScenesFound: ["No matching scenes", "일치하는 씬이 없어요", "一致するシーンがありません"],

  // Publish
  merging: ["Merging scenes into the final video…", "씬을 최종 영상으로 합치는 중…", "シーンを最終動画に結合中…"],
  mergeFailed: ["Merge failed", "병합에 실패했어요", "結合に失敗しました"],
  mergeRetry: ["Retry merge", "병합 다시 시도", "結合を再試行"],
  mergeRegenerate: ["Regenerate final video", "최종 영상 다시 생성", "最終動画を再生成"],
  mergeRegenerating: ["Regenerating…", "다시 생성하는 중…", "再生成中…"],
  finalVideo: ["Final video", "최종 영상", "最終動画"],
  publishTo: ["Publish to", "게시할 곳", "公開先"],
  publishYoutube: ["YouTube Shorts", "유튜브 쇼츠", "YouTube ショート"],
  connectYoutube: ["Connect YouTube", "유튜브 연결", "YouTube を連携"],
  connectedAs: ["Connected as {name}", "{name}(으)로 연결됨", "{name} として連携中"],
  youtubeAccount: ["your channel", "내 채널", "あなたのチャンネル"],
  disconnect: ["Disconnect", "연결 해제", "連携を解除"],
  publishToYoutube: ["Publish to YouTube Shorts", "유튜브 쇼츠에 게시", "YouTube ショートに公開"],
  publishing: ["Publishing…", "게시 중…", "公開中…"],
  viewOnYoutube: ["View on YouTube", "유튜브에서 보기", "YouTube で見る"],
  loadingEllipsis: ["Loading…", "불러오는 중…", "読み込み中…"],
  youtubeConnected: ["YouTube connected", "유튜브가 연결되었어요", "YouTube を連携しました"],
  publishInstagram: ["Instagram Reels", "인스타그램 릴스", "Instagram リール"],
  connectInstagram: ["Connect Instagram", "인스타그램 연결", "Instagram を連携"],
  instagramAccount: ["your account", "내 계정", "あなたのアカウント"],
  publishToInstagram: ["Publish to Instagram Reels", "인스타그램 릴스에 게시", "Instagram リールに公開"],
  viewOnInstagram: ["View on Instagram", "인스타그램에서 보기", "Instagram で見る"],
  instagramConnected: ["Instagram connected", "인스타그램이 연결되었어요", "Instagram を連携しました"],
  publishTiktok: ["TikTok", "틱톡", "TikTok"],
  connectTiktok: ["Connect TikTok", "틱톡 연결", "TikTok を連携"],
  tiktokAccount: ["your account", "내 계정", "あなたのアカウント"],
  publishToTiktok: ["Publish to TikTok", "틱톡에 게시", "TikTok に公開"],
  tiktokPublished: ["Published to TikTok", "틱톡에 게시했어요", "TikTok に公開しました"],
  tiktokConnected: ["TikTok connected", "틱톡이 연결되었어요", "TikTok を連携しました"],
  download: ["Download", "다운로드", "ダウンロード"],
  startNew: ["New video", "새 영상 만들기", "新しい動画を作成"],
  backToAnimate: ["Back to Animate", "Animate로 돌아가기", "Animate に戻る"],
  summaryStoryboard: ["STORYBOARD", "STORYBOARD", "STORYBOARD"],
  summaryAnimate: ["ANIMATE", "ANIMATE", "ANIMATE"],
  summaryModels: ["MODELS", "MODELS", "MODELS"],

  // Library
  library: ["Library", "라이브러리", "ライブラリ"],
  librarySub: ["all your story videos", "모든 스토리 영상", "すべてのストーリー動画"],
  filterAll: ["All", "전체", "すべて"],
  deleteRun: ["Delete", "삭제", "削除"],
  deleteRunTitle: ["Delete this project", "프로젝트 삭제", "このプロジェクトを削除"],
  deleteConfirm: ["Delete this run? Generated media stays in storage.", "이 작업을 삭제할까요? 생성된 미디어는 저장소에 남아요.", "この制作を削除しますか？生成されたメディアはストレージに残ります。"],
  open: ["Open", "열기", "開く"],

  // Brand Kit
  bkTitle: ["Brand Kit", "브랜드 키트", "ブランドキット"],
  bkSub: ["assets ready to drop into any run", "영상 제작에 바로 쓰는 에셋", "どの制作にもすぐ使えるアセット"],
  bkUpload: ["+ Upload asset", "+ 에셋 업로드", "+ アセットをアップロード"],
  bkUploading: ["Uploading…", "업로드 중…", "アップロード中…"],
  bkAnalyzing: ["Categorizing…", "분류 중…", "分類中…"],
  bkCatAll: ["All", "전체", "すべて"],
  bkCatLogo: ["Logos", "로고", "ロゴ"],
  bkCatCharacter: ["Characters", "캐릭터", "キャラクター"],
  bkCatObject: ["Products & objects", "제품·사물", "製品・物"],
  bkCatColor: ["Colors", "컬러 팔레트", "カラーパレット"],
  bkCatType: ["Type", "타이포그래피", "タイポグラフィ"],
  bkCatMotion: ["Motion presets", "모션 프리셋", "モーションプリセット"],
  bkCatOther: ["Other", "기타", "その他"],
  bkEmpty: ["No assets in this category yet", "아직 이 카테고리에 에셋이 없어요", "このカテゴリにはまだアセットがありません"],
  bkEmptyAll: [
    "No Brand Kit assets yet — upload a logo, character sheet, palette, or anything else your videos should stay consistent with.",
    "아직 브랜드 키트 에셋이 없어요 — 로고, 캐릭터 시트, 컬러 팔레트 등 영상에 일관되게 반영할 에셋을 업로드해 보세요.",
    "ブランドキットのアセットはまだありません — ロゴ、キャラクターシート、カラーパレットなど、動画で一貫させたいものをアップロードしましょう。",
  ],
  bkAnalyzeFailed: ["Couldn't categorize this asset", "에셋을 분류하지 못했어요", "このアセットを分類できませんでした"],
  bkUse: ["Use", "사용", "使用"],
  bkSelectedCount: ["{n} selected", "{n}개 선택됨", "{n}件選択中"],
  bkUseSelected: ["Use {n}", "{n}개 사용", "{n}件を使用"],
  bkUsedToast: [
    "Added {n} to your reference images on Home",
    "홈 화면의 레퍼런스 이미지에 {n}개를 추가했어요",
    "ホームの参照画像に{n}件追加しました",
  ],
  bkDeleteAsset: ["Remove asset", "에셋 삭제", "アセットを削除"],
  bkDeleteAssetTitle: ["Delete this asset", "이 에셋 삭제", "このアセットを削除"],
  bkDeleteAssetConfirm: [
    "Delete this Brand Kit asset? This can't be undone.",
    "이 브랜드 키트 에셋을 삭제할까요? 이 작업은 되돌릴 수 없어요.",
    "このブランドキットのアセットを削除しますか？この操作は元に戻せません。",
  ],

  // Storyboard — per-scene delete
  sceneOptions: ["Scene options", "장면 옵션", "シーンのオプション"],
  deleteScene: ["Delete", "삭제", "削除"],
  deleteSceneTitle: ["Delete scene", "장면 삭제", "シーンを削除"],
  deleteSceneConfirm: [
    "This scene will be deleted permanently. This action cannot be undone.",
    "이 장면은 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없어요.",
    "このシーンは完全に削除されます。この操作は元に戻せません。",
  ],
  cantDeleteLastScene: ["A run needs at least one scene", "최소 한 개의 장면이 필요해요", "少なくとも1つのシーンが必要です"],
  cancel: ["Cancel", "취소", "キャンセル"],
} as const

export type PosKey = keyof typeof DICT

interface PosI18n {
  lang: PosLang
  t: (key: PosKey, vars?: Record<string, string | number>) => string
}

const LANG_INDEX: Record<PosLang, 0 | 1 | 2> = { en: 0, kr: 1, ja: 2 }

function resolvePosLang(normalized: string): PosLang {
  if (normalized === "ko") return "kr"
  if (normalized === "ja") return "ja"
  return "en"
}

const Ctx = React.createContext<PosI18n>({
  lang: "en",
  t: (k) => String(k),
})

export function PosI18nProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const lang = resolvePosLang(normalizePaletteLanguage(platform.language, "en"))
  const t = React.useCallback(
    (key: PosKey, vars?: Record<string, string | number>) => {
      let s: string = DICT[key][LANG_INDEX[lang]]
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
