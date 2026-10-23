import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MainPanel } from '@/shell/MainPanel'
import { RightPanel } from '@/shell/RightPanel'
import { Sidebar } from '@/shell/Sidebar'
import { TopBar } from '@/shell/TopBar'

export default function App() {
  const [space, setSpace] = useState<SpaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(false)
  const [activeType, setActiveType] = useState<TypeDef | null>(null)

  useEffect(() => {
    api
      .space()
      .then((s) => {
        setSpace(s)
        document.title = `${s.name} · Object`
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col bg-app text-fg">
        <TopBar
          spaceName={space?.name ?? '…'}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleRightPanel={() => setRightOpen((v) => !v)}
          rightPanelOpen={rightOpen}
        />
        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <Sidebar
              types={space?.types ?? []}
              activeTypeId={activeType?.id}
              onOpenType={setActiveType}
            />
          )}
          <MainPanel>
            <div className="flex h-full items-center justify-center p-8 text-center">
              {error ? (
                <div>
                  <p className="font-semibold">Can't reach the Object back end.</p>
                  <p className="mt-1 text-fg-muted">{error}</p>
                </div>
              ) : activeType ? (
                <div>
                  <p className="font-semibold">{activeType.pluralName}</p>
                  <p className="mt-1 text-fg-muted">The type list arrives with tabs and pages.</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold">Pick an object type</p>
                  <p className="mt-1 text-fg-muted">Choose a type in the sidebar to see its objects.</p>
                </div>
              )}
            </div>
          </MainPanel>
          <RightPanel open={rightOpen} />
        </div>
      </div>
    </TooltipProvider>
  )
}
