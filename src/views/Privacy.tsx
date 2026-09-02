import { useDerived } from '../state/derived';
import { Card, SectionTitle } from '../components/ui';
import {
  PRIVACY_PROMISES,
  PRIVACY_NEVERS,
  PRIVACY_OFFLINE_NOTE,
} from '../services/privacyService';
import { cacheInfo } from '../services/curriculumService';

export function Privacy() {
  const d = useDerived();
  const cache = cacheInfo();

  return (
    <div className="space-y-4">
      <Card className="bg-emerald-600 text-white ring-0">
        <h2 className="text-lg font-black">🔒 Your privacy is the design.</h2>
        <p className="mt-1 text-sm text-emerald-50">
          No account required. Your academic information is not saved or shared.
        </p>
      </Card>

      <Card>
        <SectionTitle icon="✅" title="What CGPA PILOT does" />
        <ul className="space-y-2 text-sm text-slate-700">
          {PRIVACY_PROMISES.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 text-emerald-600">✔</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle icon="🚫" title="What CGPA PILOT does NOT do" />
        <ul className="space-y-2 text-sm text-slate-700">
          {PRIVACY_NEVERS.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 text-red-500">✖</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle
          icon="📦"
          title="What ships with the app (offline curriculum)"
        />
        <p className="text-sm leading-relaxed text-slate-700">
          The app carries published, non-personal configuration for{' '}
          <strong>
            {d.university.name} · {d.school?.name} · {d.programme?.shortName}
          </strong>{' '}
          — the grading system and degree-classification rules, plus any
          curriculum version published by the administrator. This is public
          academic configuration, not student information.
        </p>
        <p className="mt-2 text-xs text-slate-500">{PRIVACY_OFFLINE_NOTE}</p>
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 ring-1 ring-slate-100">
          Offline curriculum source: <strong>{cache.source}</strong>
          {cache.cachedAt ? ` (updated ${new Date(cache.cachedAt).toLocaleString()})` : ' (bundled with the app)'}
        </div>
      </Card>

      <Card>
        <SectionTitle
          icon="🔄"
          title="Temporary session · Refresh / Clear"
        />
        <ul className="space-y-2 text-sm text-slate-700">
          <li className="flex gap-2">
            <span className="mt-0.5 text-emerald-600">✔</span>
            <span>
              Everything you enter — CGPA, semester GPAs, courses, targets,
              projections and What-If scenarios — lives in temporary memory
              only. <strong>After a browser refresh it does not come back.</strong>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 text-emerald-600">✔</span>
            <span>
              The persistent <strong>🔄 Refresh / Clear</strong> button always
              asks for confirmation first. <em>Cancel</em> changes nothing;
              <em> Clear &amp; Refresh</em> wipes the session and restarts the
              app at a clean starting screen. Nothing is saved to restore.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 text-emerald-600">✔</span>
            <span>
              On browsers that support it, refreshing or closing the tab while
              you have temporary calculations shows a warning that they will be
              lost. Some mobile browsers cannot show this warning — the data is
              still temporary and still disappears on refresh.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 text-emerald-600">✔</span>
            <span>
              Reconnecting to the internet never uploads your calculations.
              Only published, non-personal curriculum configuration may refresh
              in the background; student data never synchronizes, because there
              is nowhere it is stored to sync from.
            </span>
          </li>
        </ul>
      </Card>

      <Card>
        <SectionTitle icon="🖨️" title="A note on printing" />
        <p className="text-sm leading-relaxed text-slate-700">
          Printing or saving a PDF creates a file on <em>your</em> device or
          printer. CGPA PILOT does not send it anywhere. You control who sees it.
        </p>
      </Card>

      <p className="px-2 text-center text-[11px] text-slate-400">
        CGPA PILOT is an unofficial planning aid and is not affiliated with or
        endorsed by {d.university.name}.
      </p>
    </div>
  );
}
