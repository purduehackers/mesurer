import { createRoot } from "react-dom/client";
import { Mesurer } from "mesurer";

// A page as Astro's dev server renders it: elements carry their source file and line.
createRoot(document.getElementById("root")!).render(
  <>
    <main style={{ padding: 48, fontFamily: "system-ui" }}>
      <h1
        data-astro-source-file="src/pages/index.astro"
        data-astro-source-loc="12:5"
        style={{ fontSize: 32, margin: 0, padding: "80px 40px", background: "#eef" }}
      >
        Merch drop
      </h1>
      <button
        data-testid="page-button"
        style={{ marginTop: 24, padding: "12px 20px" }}
        onClick={(event) => {
          event.currentTarget.textContent = "Clicked";
        }}
      >
        Buy
      </button>
    </main>
    <Mesurer bridge initialState={{ enabled: true }} />
  </>,
);
