import { Card, SectionTitle } from '../components/ui';

export function Privacy() {
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
          {[
            'Every calculation runs locally on your device — CGPA, targets, feasibility, what-ifs, flight path and projections.',
            'Works fully offline after first load. No internet, API calls, cloud functions, online databases, logins or external AI are used for calculations.',
            'Asks only for the numbers needed for a calculation (e.g. credits and grades, or current CGPA and total credits).',
            'Treats everything you type as a temporary session: close the tab, refresh, or press Refresh/Clear and it is gone.',
            'Lets you print an anonymous brief — no name or student ID appears, and the file stays on your device.',
          ].map((t, i) => (
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
          {[
            'Does NOT ask for your name, student ID, email or phone number.',
            'Does NOT create accounts or a student database.',
            'Does NOT store your CGPA, GPA, grades, targets or scenarios in any browser storage, persistent database or offline cache.',
            'Does NOT put your academic data in the web address (URL).',
            'Does NOT upload your transcript or course results anywhere.',
            'Does NOT use tracking/analytics storage tied to your academic data.',
          ].map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 text-red-500">✖</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle icon="📦" title="What ships with the app" />
        <p className="text-sm leading-relaxed text-slate-700">
          The app carries published, non-personal configuration for{' '}
          <strong>University of Cape Coast · School of Pharmacy · PharmD</strong>
          — the grading scale and degree-classification rules. Curriculum course
          lists are configured by the administrator. This is public academic
          configuration, not student information, and it is what enables full
          offline use.
        </p>
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
        endorsed by the University of Cape Coast.
      </p>
    </div>
  );
}
