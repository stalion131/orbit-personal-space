export function AppVersion() {
  return (
    <span className="app-version" aria-label="Версия сервиса">
      Версия {process.env.NEXT_PUBLIC_ORBIT_VERSION} ·{' '}
      {process.env.NEXT_PUBLIC_ORBIT_REVISION}
    </span>
  );
}
