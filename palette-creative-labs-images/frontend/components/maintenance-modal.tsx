"use client"

import React from "react"
import { IconTools, IconX } from "@tabler/icons-react"
import { useT } from "@/lib/i18n"

export const MaintenanceModal = ({ onClose }: { onClose?: () => void }) => {
  const { t } = useT()
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 animate-in fade-in duration-300">
      <div
        className="relative bg-background border border-border rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-5 max-w-sm w-full mx-4 text-center animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (optional) */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <IconX className="size-4" />
          </button>
        )}

        {/* Icon */}
        <div className="size-16 flex items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <IconTools className="size-8" />
        </div>

        {/* Text */}
        <div className="space-y-2">
          <h2 className="text-xl font-medium">{t("maintenance.title")}</h2>
          <p className="text-muted-foreground">
            {t("maintenance.body")}
          </p>
        </div>
      </div>
    </div>
  )
}
