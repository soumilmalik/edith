import { pcRun } from "./pcAgent.js";

// Tools backed by the local PC agent. Only offered to Claude when the agent is
// paired, reachable and not paused (see getToolSchemas in tools.js) - so on a
// phone they simply don't exist and Claude never tries them.
export const PC_TOOL_SCHEMAS = [
  {
    name: "pc_open_file",
    description:
      "Find and open a file on the user's PC (they use the 'Everything' search tool, so this is instant across all their folders). Pass `query` as the natural words the user said - e.g. 'physics unit 2 notes', 'ece assignment 2', 'midsem admit card' - names are matched loosely ('unit 2' = 'unit2' = 'Unit-2'), and folder names count too (e.g. 'dtu-acad'). Optional `ext` (pdf, docx, pptx, ...). It opens the file directly when one match clearly wins; if several are similar it returns them as `hits` - then ask the user which one (or pick if obvious) and call again with `path`. Documents, images and media only - it will refuse programs/scripts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words describing the file" },
        ext: { type: "string", description: "Optional file type, e.g. pdf" },
        path: { type: "string", description: "Exact full path from a previous result - use this instead of query to open a specific file" },
      },
    },
  },
  {
    name: "pc_search_files",
    description:
      "Search the user's PC for files WITHOUT opening anything - use when the user asks 'do I have...', 'where is...', or wants to pick between candidates. Same query rules as pc_open_file. Returns up to `max` ranked results with path, size and modified date.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        ext: { type: "string" },
        max: { type: "integer", description: "Default 10, max 30" },
      },
      required: ["query"],
    },
  },
  {
    name: "pc_open_url",
    description:
      "Open a web page in the browser on the user's PC. http(s) only. Use for 'open YouTube', 'go to Notion', or any page you already know the exact URL of.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "pc_open_app",
    description:
      "Launch an app on the user's PC by name - e.g. notepad, notion, whatsapp, spotify, vscode, chrome, brave, edge, calculator, clock. It only launches the app; it can't type or click inside it.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "pc_movie_showtimes",
    description:
      "Open the movie-listings page for a film so the user sees timings and prices. Use for 'pull up / show me the prices for <movie> on <day>' style requests. platform 'district' (default) opens District's search results for the movie in that city - verified to work. platform 'bookmyshow' opens a search that leads to BookMyShow's page for it in one extra click. It cannot select a show or reach checkout/payment - stop at the listings page and tell the user that.",
    input_schema: {
      type: "object",
      properties: {
        movie: { type: "string" },
        city: { type: "string" },
        theatre: { type: "string", description: "Optional theatre/cinema name" },
        platform: { type: "string", enum: ["district", "bookmyshow"] },
      },
      required: ["movie"],
    },
  },
  {
    name: "pc_make_pdf",
    description:
      "Turn a finished write-up into a PDF on the user's PC and open it (saved in Documents/Edith). `html` is the BODY html only (h1/h2/p/ul/ol/table/div.answer...). Write math as LaTeX in $...$ (inline) and $$...$$ (display) - it is rendered properly. Don't use scripts, images or external links. For worked solutions to a problem, prefer solve_with_expert with output 'pdf', which does this itself.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        html: { type: "string" },
      },
      required: ["title", "html"],
    },
  },
];

export const PC_STATUS_LABELS = {
  pc_open_file: "Finding your file...",
  pc_search_files: "Searching your files...",
  pc_open_url: "Opening the page...",
  pc_open_app: "Launching the app...",
  pc_movie_showtimes: "Pulling up showtimes...",
  pc_make_pdf: "Making the PDF...",
};

export async function executePcTool(name, input) {
  switch (name) {
    case "pc_open_file":
      if (input.path) return pcRun("open_file", { filePath: input.path });
      if (!input.query) return { error: "Provide either query or path" };
      return pcRun("open_best_match", { query: input.query, ext: input.ext });
    case "pc_search_files":
      return pcRun("search_files", { query: input.query, ext: input.ext, maxResults: input.max });
    case "pc_open_url":
      return pcRun("open_url", { url: input.url });
    case "pc_open_app":
      return pcRun("open_app", { name: input.name });
    case "pc_movie_showtimes":
      return pcRun("movie_showtimes", input);
    case "pc_make_pdf":
      return pcRun("make_solution_pdf", { title: input.title, html: input.html });
    default:
      return { error: `Unknown PC tool: ${name}` };
  }
}
