"use client"

import React, { createContext, useContext, useState } from "react"
import { videoModelOptions } from "@/components/layout/video-helper"

export type ModelMode = "image" | "video"

const videoValues = new Set(videoModelOptions.map((m) => m.value))

interface ModelContextType {
  selectedModels: string[]
  setSelectedModels: React.Dispatch<React.SetStateAction<string[]>>
  mode: ModelMode
  setMode: React.Dispatch<React.SetStateAction<ModelMode>>
}

const ModelContext = createContext<ModelContextType | undefined>(undefined)

export const ModelProvider = ({ children }: { children: React.ReactNode }) => {
  const [selectedModels, setSelectedModels] = useState([videoModelOptions[0].value])
  const [mode, setMode] = useState<ModelMode>("video")

  return (
    <ModelContext.Provider value={{ selectedModels, setSelectedModels, mode, setMode }}>
      {children}
    </ModelContext.Provider>
  )
}

export const useModelContext = () => {
  const ctx = useContext(ModelContext)
  if (!ctx) throw new Error("useModelContext must be used within ModelProvider")
  return ctx
}
