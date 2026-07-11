import type { FC } from 'react'
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { SettingsSidebarLayout } from '@/components/layout/SettingsSidebarLayout'
import { SidebarLayout } from '@/components/layout/SidebarLayout'
import { RouteDocumentTitle } from '@/lib/document-title/RouteDocumentTitle'
import { ActionLogPage } from '@/screens/action-log/ActionLogPage'
import { AgentCommandConversation } from '@/screens/agent-command/AgentCommandConversation'
import { AgentCommandHome } from '@/screens/agent-command/AgentCommandHome'
import { AgentCommandLayout } from '@/screens/agent-command/AgentCommandLayout'
import { AISettingsPage } from '@/screens/ai-settings/AISettingsPage'
import { CapturePage } from '@/screens/capture/CapturePage'
import { ConnectMCP } from '@/screens/connect-mcp/ConnectMCP'
import { ContextPage } from '@/screens/context/ContextPage'
import { CustomizationPage } from '@/screens/customization/CustomizationPage'
import { MCPSettingsPage } from '@/screens/mcp-settings/MCPSettingsPage'
import { MemoryPage } from '@/screens/memory/MemoryPage'
import { NewTabChat } from '@/screens/newtab/index/NewTabChat'
import { NewTabLayout } from '@/screens/newtab/layout/NewTabLayout'
import { Personalize } from '@/screens/newtab/personalize/Personalize'
import { OnboardingDemo } from '@/screens/onboarding/demo/OnboardingDemo'
import { FeaturesPage } from '@/screens/onboarding/features/Features'
import { Onboarding } from '@/screens/onboarding/index/Onboarding'
import { StepsLayout } from '@/screens/onboarding/steps/StepsLayout'
import { ReachSettingsPage } from '@/screens/reach/ReachSettingsPage'
import { ScheduledTasksPage } from '@/screens/scheduled-tasks/ScheduledTasksPage'
import { TasksPage } from '@/screens/tasks/TasksPage'
import { WorkspacesPage } from '@/screens/workspaces/WorkspacesPage'

// Agent management moved into AI & Agents settings; conversations live under
// /home/agents. Keep old /agents links alive.
const LegacyAgentRedirect: FC = () => {
  const params = useParams()
  return <Navigate to={`/home/agents/${params.agentId ?? ''}`} replace />
}

const OptionsRedirect: FC = () => {
  const params = useParams()
  const path = params['*'] || ''

  const routeMap: Record<string, string> = {
    ai: '/settings/ai',
    'connect-mcp': '/connect-apps',
    mcp: '/settings/mcp',
    customization: '/settings/customization',
    search: '/settings/ai',
    scheduled: '/scheduled',
  }

  const newPath = routeMap[path] || '/settings/ai'
  return <Navigate to={newPath} replace />
}

export const App: FC = () => {
  return (
    <HashRouter>
      <RouteDocumentTitle />
      <Routes>
        <Route element={<SidebarLayout />}>
          <Route path="home" element={<NewTabLayout />}>
            <Route element={<AgentCommandLayout />}>
              <Route index element={<AgentCommandHome />} />
              <Route
                path="agents/:agentId"
                element={<AgentCommandConversation />}
              />
              <Route
                path="agents/:agentId/sessions/:sessionId"
                element={<AgentCommandConversation />}
              />
            </Route>
            <Route path="chat" element={<NewTabChat />} />
            <Route path="personalize" element={<Personalize />} />
          </Route>

          <Route path="connect-apps" element={<ConnectMCP />} />
          <Route path="workspaces">
            <Route index element={<WorkspacesPage />} />
            <Route path=":id" element={<WorkspacesPage />} />
          </Route>
          <Route path="context" element={<ContextPage />} />
          <Route path="capture" element={<CapturePage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="scheduled" element={<ScheduledTasksPage />} />
        </Route>

        <Route element={<SettingsSidebarLayout />}>
          <Route path="settings">
            <Route index element={<Navigate to="/settings/ai" replace />} />
            <Route path="ai" element={<AISettingsPage key="ai" />} />
            <Route path="mcp" element={<MCPSettingsPage />} />
            <Route path="customization" element={<CustomizationPage />} />
            <Route path="action-log" element={<ActionLogPage />} />
            <Route path="memory" element={<MemoryPage />} />
            <Route path="reach" element={<ReachSettingsPage />} />
            <Route
              path="search"
              element={<Navigate to="/settings/ai" replace />}
            />
            <Route path="*" element={<Navigate to="/settings/ai" replace />} />
          </Route>
        </Route>

        <Route path="onboarding">
          <Route index element={<Onboarding />} />
          <Route path="steps/:stepId" element={<StepsLayout />} />
          <Route path="demo" element={<OnboardingDemo />} />
          <Route path="features" element={<FeaturesPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route
          path="/personalize"
          element={<Navigate to="/home/personalize" replace />}
        />
        <Route
          path="/settings/connect-mcp"
          element={<Navigate to="/connect-apps" replace />}
        />
        <Route path="/audit" element={<Navigate to="/home" replace />} />
        <Route
          path="/observability"
          element={<Navigate to="/home" replace />}
        />
        <Route path="/executions" element={<Navigate to="/home" replace />} />
        <Route
          path="/agents"
          element={<Navigate to="/settings/ai" replace />}
        />
        <Route path="/mcp" element={<Navigate to="/settings/mcp" replace />} />
        <Route path="/agents/:agentId" element={<LegacyAgentRedirect />} />
        <Route path="/options/*" element={<OptionsRedirect />} />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </HashRouter>
  )
}
