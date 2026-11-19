import type { Dispatch } from 'react';
import { isPhased, phaseCounts, phaseOf, PHASE_LABEL, PHASE_VIEWS, PHASES, setPhase, type PhaseView } from '../model/phase.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import type { Hit } from './hitTest.ts';
import './phasing.css';

// Plan toolbar controls for remodel phasing: which phases the plan shows, and the
// phase of the picked element. (Marking the whole plan existing is in the
// Options dialog.)

interface Props {
  project: Project;
  dispatch: Dispatch<Action>;
  selection: Hit | null;
  view: PhaseView;
  setView(v: PhaseView): void;
}

export function PhaseBar({ project, dispatch, selection, view, setView }: Props) {
  const picked = selection && selection.kind !== 'dim' ? selection.id : null;
  const phased = isPhased(project);
  const counts = phased ? phaseCounts(project) : null;
  const set = (ids: string[], phase: (typeof PHASES)[number]) => dispatch({ type: 'replaceProject', project: setPhase(project, ids, phase) });
  return (
    <div className="phase-bar">
      <select
        value={view}
        onChange={(e) => setView(e.target.value as PhaseView)}
        aria-label="Phases shown"
        title={counts ? `Existing ${counts.existing} · demolish ${counts.demo} · new ${counts.new}` : 'Remodel phases: mark items existing or demolish, then show the existing, demolition or new plan'}
      >
        {PHASE_VIEWS.map((v) => (
          <option key={v.id} value={v.id} title={v.title}>
            {v.id === 'all' ? 'All phases' : `${v.label} plan`}
          </option>
        ))}
      </select>
      {picked && (
        <div className="seg" role="group" aria-label="Phase of the selected item">
          {PHASES.map((ph) => (
            <button key={ph} className={`ph-${ph}${phaseOf(project, picked) === ph ? ' active' : ''}`} onClick={() => set([picked], ph)} title={`Mark the selected item ${PHASE_LABEL[ph].toLowerCase()}`}>
              {PHASE_LABEL[ph]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
