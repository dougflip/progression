import { useEffect, useState } from "react";
import { decodeEnvelope, encodeEnvelope, validateEnvelope } from "../model/envelope";
import type { ShareEnvelope } from "../model/schema";

/**
 * Milestone 1 placeholder: proves v2 builds, deploys and validates data.
 * Opens a shared link (`?s=…`) and shows what it holds, or lists the fixtures.
 * The engine bench (Milestone 3) replaces this.
 */

const fixtures = import.meta.glob<unknown>("../../fixtures/*.json", {
  import: "default",
  eager: true,
});
const fixtureList = Object.entries(fixtures)
  .filter(([path]) => !path.endsWith("/frozen.json"))
  .map(([path, env]) => ({
    name: path
      .split("/")
      .pop()!
      .replace(/\.json$/, ""),
    env,
  }));

type Shared =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; env: ShareEnvelope }
  | { status: "bad"; errors: string[] };

export function App() {
  const shared = useSharedLink();
  return (
    <main>
      <h1>Progression v2</h1>
      <p>
        Foundation build: data format only, no sound yet. <a href="../">Back to v1</a>
      </p>
      {shared.status !== "none" && <SharedLink shared={shared} />}
      <h2>Fixtures</h2>
      <ul>
        {fixtureList.map((f) => (
          <FixtureRow key={f.name} name={f.name} env={f.env} />
        ))}
      </ul>
    </main>
  );
}

function useSharedLink(): Shared {
  const [param] = useState(() => new URLSearchParams(location.search).get("s"));
  const [shared, setShared] = useState<Shared>(param ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!param) return;
    decodeEnvelope(param)
      .then((input) => {
        const result = validateEnvelope(input);
        setShared(
          result.ok
            ? { status: "ok", env: result.value }
            : { status: "bad", errors: result.errors },
        );
      })
      .catch((e: unknown) =>
        setShared({ status: "bad", errors: [`can't read the link: ${String(e)}`] }),
      );
  }, [param]);
  return shared;
}

function SharedLink({ shared }: { shared: Exclude<Shared, { status: "none" }> }) {
  switch (shared.status) {
    case "loading":
      return <p>Reading link…</p>;
    case "bad":
      return (
        <section>
          <h2 className="bad">Shared link is invalid</h2>
          <ul>
            {shared.errors.map((e) => (
              <li key={e}>
                <code>{e}</code>
              </li>
            ))}
          </ul>
        </section>
      );
    case "ok":
      return (
        <section>
          <h2 className="ok">Shared: {shared.env.doc.title}</h2>
          <pre>{JSON.stringify(shared.env, null, 2)}</pre>
        </section>
      );
  }
}

function FixtureRow({ name, env }: { name: string; env: unknown }) {
  const result = validateEnvelope(env);
  const [href, setHref] = useState<string>();
  useEffect(() => {
    const valid = validateEnvelope(env);
    if (valid.ok) void encodeEnvelope(valid.value).then((s) => setHref(`?s=${s}`));
  }, [env]);
  return (
    <li>
      <span className={result.ok ? "ok" : "bad"}>{result.ok ? "✓" : "✗"}</span>{" "}
      {href ? <a href={href}>{name}</a> : name}
      {!result.ok && <pre className="bad">{result.errors.join("\n")}</pre>}
    </li>
  );
}
