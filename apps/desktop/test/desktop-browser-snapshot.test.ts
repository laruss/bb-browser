import { describe, expect, it } from "vitest";
import {
  buildBrowserSnapshot,
  findBrowserSnapshotRoot,
  type AxNode,
} from "../src/desktop-browser-snapshot.js";

/**
 * The snapshot is what makes elements addressable, so the cases that matter are
 * about identity and honesty: which nodes get a ref, which are shown without
 * one, and whether a truncated tree admits it.
 */

function node(nodeId: string, overrides: Partial<AxNode> = {}): AxNode {
  return {
    nodeId,
    ignored: false,
    role: { value: "generic" },
    ...overrides,
  };
}

function role(value: string) {
  return { value };
}

function name(value: string) {
  return { value };
}

describe("buildBrowserSnapshot", () => {
  it("renders the tree in the shape agents already read", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("RootWebArea"), childIds: ["2", "3"] }),
        node("2", {
          role: role("heading"),
          name: name("todos"),
          properties: [{ name: "level", value: { value: 1 } }],
        }),
        node("3", {
          role: role("textbox"),
          name: name("What needs to be done?"),
          backendDOMNodeId: 42,
        }),
      ],
    });

    expect(snapshot.text).toBe(
      [
        "- rootwebarea:",
        '  - heading "todos" [level=1]',
        '  - textbox "What needs to be done?" [ref=e1]',
      ].join("\n"),
    );
    expect(snapshot.refs).toEqual([{ ref: "e1", backendNodeId: 42 }]);
    expect(snapshot.truncated).toBe(false);
  });

  it("gives refs to interactive nodes and withholds them from prose", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("main"), childIds: ["2", "3", "4"] }),
        node("2", {
          role: role("button"),
          name: name("Save"),
          backendDOMNodeId: 10,
        }),
        node("3", { role: role("paragraph"), name: name("Some prose") }),
        node("4", {
          // Not in the role list, but focusable — a custom widget.
          role: role("gridcell"),
          name: name("Cell"),
          backendDOMNodeId: 12,
          properties: [{ name: "focusable", value: { value: true } }],
        }),
      ],
    });

    expect(snapshot.text).toContain('- button "Save" [ref=e1]');
    expect(snapshot.text).toContain('- paragraph "Some prose"');
    expect(snapshot.text).not.toMatch(/paragraph[^\n]*ref=/u);
    expect(snapshot.refs.map((entry) => entry.backendNodeId)).toEqual([10, 12]);
  });

  it("shows a disabled control without making it addressable", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("form"), childIds: ["2"] }),
        node("2", {
          role: role("button"),
          name: name("Submit"),
          backendDOMNodeId: 7,
          properties: [{ name: "disabled", value: { value: true } }],
        }),
      ],
    });

    // Visible, because an agent should know the control exists; unaddressable,
    // because acting on it could only fail.
    expect(snapshot.text).toContain('- button "Submit" [disabled]');
    expect(snapshot.refs).toEqual([]);
  });

  it("surfaces the state that would change what an agent does", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("list"), childIds: ["2", "3", "4"] }),
        node("2", {
          role: role("checkbox"),
          name: name("Toggle"),
          backendDOMNodeId: 1,
          properties: [{ name: "checked", value: { value: true } }],
        }),
        node("3", {
          role: role("checkbox"),
          name: name("Partial"),
          backendDOMNodeId: 2,
          properties: [{ name: "checked", value: { value: "mixed" } }],
        }),
        node("4", {
          role: role("button"),
          name: name("Menu"),
          backendDOMNodeId: 3,
          properties: [{ name: "expanded", value: { value: false } }],
        }),
      ],
    });

    expect(snapshot.text).toContain('- checkbox "Toggle" [ref=e1] [checked]');
    expect(snapshot.text).toContain(
      '- checkbox "Partial" [ref=e2] [checked=mixed]',
    );
    expect(snapshot.text).toContain('- button "Menu" [ref=e3] [collapsed]');
  });

  it("shows what a field currently holds", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", {
          role: role("textbox"),
          name: name("Name"),
          value: { value: "Konstantin" },
          backendDOMNodeId: 5,
        }),
      ],
    });

    expect(snapshot.text).toBe('- textbox "Name" [ref=e1]: "Konstantin"');
  });

  it("walks through ignored wrappers to reach what matters", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("main"), childIds: ["2"] }),
        node("2", { ignored: true, childIds: ["3"] }),
        node("3", {
          role: role("link"),
          name: name("Home"),
          backendDOMNodeId: 9,
        }),
      ],
    });

    // Chromium marks plenty of wrappers ignored while their descendants are the
    // whole point; skipping their subtrees would lose the page.
    expect(snapshot.text).toBe(['- main:', '  - link "Home" [ref=e1]'].join("\n"));
  });

  it("drops unnamed structural noise but keeps named containers", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("main"), childIds: ["2", "4"] }),
        node("2", { role: role("generic"), childIds: ["3"] }),
        node("3", { role: role("text"), name: name("Buy groceries") }),
        node("4", { role: role("generic"), name: name("Sidebar") }),
      ],
    });

    expect(snapshot.text).toBe(
      ["- main:", '  - text: "Buy groceries"', '  - generic "Sidebar"'].join(
        "\n",
      ),
    );
  });

  it("escapes names that would otherwise break the format", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", {
          role: role("button"),
          name: name('Say "hi"\nnow'),
          backendDOMNodeId: 1,
        }),
      ],
    });

    expect(snapshot.text).toBe('- button "Say \\"hi\\"\\nnow" [ref=e1]');
  });

  it("admits when a cap stopped it", () => {
    const nodes: AxNode[] = [
      node("root", {
        role: role("list"),
        childIds: ["a", "b", "c"],
      }),
      node("a", { role: role("listitem"), name: name("one") }),
      node("b", { role: role("listitem"), name: name("two") }),
      node("c", { role: role("listitem"), name: name("three") }),
    ];

    const capped = buildBrowserSnapshot({ nodes, maxNodes: 2 });
    expect(capped.truncated).toBe(true);
    expect(capped.text).not.toContain("three");

    const short = buildBrowserSnapshot({ nodes, maxLength: 12 });
    expect(short.truncated).toBe(true);
    expect(short.text).toHaveLength(12);
  });

  it("stops at the requested depth", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("main"), childIds: ["2"] }),
        node("2", { role: role("list"), childIds: ["3"] }),
        node("3", { role: role("listitem"), name: name("deep") }),
      ],
      maxDepth: 1,
    });

    expect(snapshot.text).toBe(["- main:", "  - list"].join("\n"));
  });

  it("does not spin on a tree that points back at itself", () => {
    const snapshot = buildBrowserSnapshot({
      nodes: [
        node("1", { role: role("main"), childIds: ["2"] }),
        node("2", { role: role("list"), childIds: ["1"] }),
      ],
    });

    expect(snapshot.text).toBe(["- main:", "  - list"].join("\n"));
  });
});

describe("scoping a snapshot to one element", () => {
  const nodes = [
    node("1", { role: role("RootWebArea"), childIds: ["2", "5"] }),
    node("2", {
      role: role("form"),
      name: name("Checkout"),
      backendDOMNodeId: 42,
      childIds: ["3", "4"],
    }),
    node("3", {
      role: role("textbox"),
      name: name("Card"),
      backendDOMNodeId: 43,
    }),
    node("4", {
      role: role("button"),
      name: name("Pay"),
      backendDOMNodeId: 44,
    }),
    node("5", {
      role: role("button"),
      name: name("Help"),
      backendDOMNodeId: 45,
    }),
  ];

  it("renders the matched element's subtree and nothing beside it", () => {
    const root = findBrowserSnapshotRoot(nodes, 42);
    expect(root).not.toBeNull();

    const snapshot = buildBrowserSnapshot({
      nodes,
      ...(root === null ? {} : { root }),
    });

    // Indentation restarts at the scope, and the sibling button outside it is
    // gone — which is the whole point on a page too big to snapshot whole.
    expect(snapshot.text).toBe(
      [
        '- form "Checkout":',
        '  - textbox "Card" [ref=e1]',
        '  - button "Pay" [ref=e2]',
      ].join("\n"),
    );
    expect(snapshot.refs).toEqual([
      { ref: "e1", backendNodeId: 43 },
      { ref: "e2", backendNodeId: 44 },
    ]);
  });

  it("renders the contents of a wrapper the tree calls generic", () => {
    // `#app` is the selector people write, and it usually names exactly this.
    const wrapper = [
      node("1", { role: role("RootWebArea"), childIds: ["2"] }),
      node("2", { role: role("generic"), backendDOMNodeId: 7, childIds: ["3"] }),
      node("3", { role: role("button"), name: name("Go"), backendDOMNodeId: 8 }),
    ];
    const root = findBrowserSnapshotRoot(wrapper, 7);

    const snapshot = buildBrowserSnapshot({
      nodes: wrapper,
      ...(root === null ? {} : { root }),
    });

    expect(snapshot.text).toBe('- button "Go" [ref=e1]');
  });

  it("answers null for an element the tree does not describe", () => {
    // A `display: none` subtree is not in the accessibility tree at all, and
    // saying so beats handing back the whole page.
    expect(findBrowserSnapshotRoot(nodes, 999)).toBeNull();
  });
});
