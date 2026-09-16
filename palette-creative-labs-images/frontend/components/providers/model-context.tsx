"use client"

import React, { createContext, useContext, useState } from "react"
import { imageModelOptions } from "@/components/layout/video-helper"

interface ModelContextType {
  selectedModels: string[]
  setSelectedModels: React.Dispatch<React.SetStateAction<string[]>>
}

const ModelContext = createContext<ModelContextType | undefined>(undefined)

export const ModelProvider = ({ children }: { children: React.ReactNode }) => {
  const [selectedModels, setSelectedModels] = useState([imageModelOptions[0].value])

  return (
    <ModelContext.Provider value={{ selectedModels, setSelectedModels }}>
      {children}
    </ModelContext.Provider>
  )
}

export const useModelContext = () => {
  const ctx = useContext(ModelContext)
  if (!ctx) throw new Error("useModelContext must be used within ModelProvider")
  return ctx
}
