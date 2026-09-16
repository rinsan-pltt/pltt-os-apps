"use client"

import React from "react"
import { IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { ReferenceSlot, type RefImage } from "./reference-slot"
import { InfoHint } from "@/components/ui/info-hint"

// A Kling "Element" (character/object): a frontal image plus up to 3 reference
// images. Referenced in the prompt as @Element1, @Element2, …
export interface VideoElement {
  id: number
  frontal: RefImage
  references: RefImage[]
}

const MAX_ELEMENTS = 4
const MAX_REFS = 3

export function makeEmptyElement(id: number): VideoElement {
  return { id, frontal: null, references: [null] }
}

export function ElementsEditor({
  elements,
  setElements,
}: {
  elements: VideoElement[]
  setElements: (els: VideoElement[]) => void
}) {
  const addElement = () => {
    if (elements.length >= MAX_ELEMENTS) return
    setElements([...elements, makeEmptyElement(Date.now())])
  }

  const removeElement = (id: number) => setElements(elements.filter((e) => e.id !== id))

  const patch = (id: number, next: Partial<VideoElement>) =>
    setElements(elements.map((e) => (e.id === id ? { ...e, ...next } : e)))

  const setReference = (id: number, index: number, value: RefImage) => {
    const el = elements.find((e) => e.id === id)
    if (!el) return
    const refs = [...el.references]
    refs[index] = value
    // Keep one empty trailing slot available (up to MAX_REFS) so more can be added.
    const filled = refs.filter(Boolean)
    const withTrailer = filled.length < MAX_REFS ? [...filled, null] : filled
    patch(id, { references: withTrailer })
  }

  return (
    <div className="flex flex-col gap-3">
      {elements.map((el, i) => (
        <div key={el.id} className="rounded-xl border border-border60 p-3 flex flex-col gap-3 bg-background/40">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">@Element{i + 1}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeElement(el.id)}
              className="size-6 text-muted-foreground"
              aria-label="Remove element"
            >
              <IconTrash className="size-4" />
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Frontal image</span>
              <InfoHint text="The frontal image of the element (main view)." />
            </div>
            <ReferenceSlot
              className="w-20"
              label="Frontal"
              optionalLabel=""
              value={el.frontal}
              onChange={(v) => patch(el.id, { frontal: v })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
                Reference images (1–{MAX_REFS})
              </span>
              <InfoHint text="Additional reference images of the main image from different angles." />
            </div>
            <div className="flex flex-wrap gap-2">
              {el.references.map((ref, ri) => (
                <ReferenceSlot
                  key={ri}
                  className="w-20"
                  label="Ref"
                  optionalLabel=""
                  value={ref}
                  onChange={(v) => setReference(el.id, ri, v)}
                />
              ))}
            </div>
          </div>
        </div>
      ))}

      {elements.length < MAX_ELEMENTS && (
        <Button variant="outline" size="sm" className="w-full text-sm font-normal shrink-0" onClick={addElement}>
          <span className="text-xl text-muted-foreground">+</span>
          <span>Add element (@Element{elements.length + 1})</span>
        </Button>
      )}
    </div>
  )
}
