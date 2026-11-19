import type { Dispatch } from 'react';
import { roleView } from '../calc/house.ts';
import { isMultiStorey, storeyViews } from '../model/storeys.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { PrintSheet } from './PrintSheet.tsx';
import { FramingView } from './Reports.tsx';

// Storeys v1: the Framing tab and the printed plan, once per storey (lowest
// first), each on its storey's view — the foundation shows under the lowest
// and the roof on the top one (see calc/house.ts roleView).

export function HouseFramingView({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  if (!isMultiStorey(project)) return <FramingView project={project} dispatch={dispatch} />;
  return (
    <>
      {storeyViews(project).map(({ storey }) => (
        <section key={storey.id} className="storey-report">
          <h2 className="storey-title">{storey.name}</h2>
          <FramingView project={roleView(project, storey.id)} dispatch={dispatch} />
        </section>
      ))}
    </>
  );
}

/** One plan sheet per storey (each with its own schedule; the roof plan follows the top one). */
export function HousePrint({ project }: { project: Project }) {
  if (!isMultiStorey(project)) return <PrintSheet project={project} />;
  return (
    <>
      {storeyViews(project)
        .filter(({ view }) => view.walls.length)
        .map(({ storey }) => {
          const v = roleView(project, storey.id);
          return (
            <div key={storey.id} className="storey-print">
              <PrintSheet project={{ ...v, name: `${project.name} — ${storey.name}` }} />
            </div>
          );
        })}
    </>
  );
}
