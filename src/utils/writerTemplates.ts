// Document scaffolds for the Writer. Starting from a structured outline
// instead of a blank page is the single biggest accelerator for drafting —
// you write *into* sections rather than inventing structure first.

export interface WriterTemplate {
  id:          string;
  label:       string;
  description: string;
  title:       string;   // default doc title
  content:     string;   // markdown body
}

export const WRITER_TEMPLATES: WriterTemplate[] = [
  {
    id:    'paper',
    label: 'Research paper (IMRaD)',
    description: 'Full empirical paper: Abstract → Intro → Related Work → Method → Experiments → Results → Discussion → Conclusion.',
    title: 'Untitled paper',
    content: `# Abstract

_One paragraph (~150–250 words): problem, gap, what you do, key result, why it matters._

# 1. Introduction

- What is the problem and why does it matter?
- What is missing in prior work? (the gap)
- What do you propose, in one sentence?
- Contributions:
  - …
  - …

# 2. Related Work

_Group prior work by theme; end each group by stating how you differ._

# 3. Method

_Setup, notation, model/approach. State assumptions explicitly._

# 4. Experiments

- Datasets / data:
- Baselines:
- Metrics:
- Implementation details:

# 5. Results

_Lead with the headline finding. One claim per paragraph, each backed by a number or figure._

# 6. Discussion

_What the results mean, limitations, threats to validity._

# 7. Conclusion

_Restate the contribution and one concrete next step._

# References
`,
  },
  {
    id:    'litreview',
    label: 'Literature review',
    description: 'Survey a topic: scope, themes, comparison, open problems.',
    title: 'Untitled review',
    content: `# Abstract

_What this review covers and the main takeaway._

# 1. Scope & Motivation

- Why review this now?
- What's included / excluded?

# 2. Background

_Key definitions and the shared vocabulary the reader needs._

# 3. Themes

## 3.1 Theme A

## 3.2 Theme B

## 3.3 Theme C

# 4. Comparison

_A table or synthesis across the themes — what trades off against what._

# 5. Open Problems

- …
- …

# 6. Conclusion

# References
`,
  },
  {
    id:    'note',
    label: 'Short note / blog',
    description: 'A focused write-up or technical blog post — hook, body, takeaway.',
    title: 'Untitled note',
    content: `# Title

_One-line hook: what will the reader learn?_

## The idea

## Why it works

## In practice

## Takeaway

- …
`,
  },
  {
    id:    'proposal',
    label: 'Grant / proposal',
    description: 'Research proposal: aims, significance, approach, timeline.',
    title: 'Untitled proposal',
    content: `# Summary

_Two or three sentences a non-specialist reviewer can follow._

# Specific Aims

- **Aim 1.** …
- **Aim 2.** …
- **Aim 3.** …

# Significance

_What changes if this succeeds? Who benefits?_

# Innovation

_What's genuinely new here versus the state of the art._

# Approach

## Preliminary data

## Methods

## Risks & alternatives

# Timeline & Milestones

| Quarter | Milestone |
| --- | --- |
| Q1 | … |
| Q2 | … |

# References
`,
  },
  {
    id:    'blank',
    label: 'Blank document',
    description: 'Start from an empty page.',
    title: 'Untitled',
    content: '',
  },
];

// Build a starter doc from a generated topic (title + outline bullets).
export function docFromTopic(title: string, outline: string[]): { title: string; content: string } {
  const body = outline.length
    ? outline.map(s => `# ${s.replace(/^#+\s*/, '')}\n`).join('\n')
    : '';
  return { title, content: `${body}`.trim() + (body ? '\n' : '') };
}
