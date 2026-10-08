import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { emptyDraft, selectComposerTab } from '../modules/chat/composer-store'
import { snapshotComposerDraft } from '../modules/chat/snapshot-composer-draft'
import { ChatInput } from '../screens/sidepanel/index/ChatInput'

function Fixture() {
  const [draft, setDraft] = useState({
    ...emptyDraft(),
    text: 'same price ',
    tabs: [
      {
        id: 1,
        title: 'Old Payments Page',
        url: 'https://example.com/payments',
      } as chrome.tabs.Tab,
    ],
  })
  return (
    <>
      <ChatInput
        input={draft.text}
        status="ready"
        mode="agent"
        selectedTabs={draft.tabs}
        onInputChange={(text) => setDraft((value) => ({ ...value, text }))}
        onSelectTab={(tab) =>
          setDraft((value) => ({
            ...value,
            tabs: selectComposerTab(value.tabs, tab),
          }))
        }
        onStop={() => {}}
        onSubmit={() => {
          void snapshotComposerDraft(draft).then((value) => {
            document.documentElement.dataset.sent = JSON.stringify(value)
          })
        }}
      />
      <output id="draft-state">{JSON.stringify(draft)}</output>
    </>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(<Fixture />)
