import type { SvgIconComponent } from '@mui/icons-material';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import CodeIcon from '@mui/icons-material/Code';
import EngineeringIcon from '@mui/icons-material/Engineering';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ShieldIcon from '@mui/icons-material/Shield';
import { ARCHITECT } from './ArchitectAssistantPage';
import type { AssistantProfile } from './AssistantPage';
import { DEVELOPER } from './DeveloperAssistantPage';
import { FUNCTIONAL } from './FunctionalAssistantPage';
import { OPS } from './OpsAssistantPage';
import { SEC } from './SecAssistantPage';

/** One assistant in the console: its page (/console/<id>), name, colour, icon and profile. */
export type ConsoleAssistantDef = { id: string; name: string; colour: string; Icon: SvgIconComponent; profile: AssistantProfile };

/** The assistants in the order of the delivery chain: specify, design, build, operate, secure. */
export const CONSOLE_ASSISTANTS: ConsoleAssistantDef[] = [
  { id: 'functional-assistant', name: 'Functional', colour: '#7B61FF', Icon: LightbulbIcon, profile: FUNCTIONAL },
  { id: 'architect-assistant', name: 'Architect', colour: '#00A3A3', Icon: ArchitectureIcon, profile: ARCHITECT },
  { id: 'developer-assistant', name: 'Developer', colour: '#1A8DFF', Icon: CodeIcon, profile: DEVELOPER },
  { id: 'ops-assistant', name: 'Operations', colour: '#E8A33D', Icon: EngineeringIcon, profile: OPS },
  { id: 'sec-assistant', name: 'Security', colour: '#D64B8A', Icon: ShieldIcon, profile: SEC },
];
