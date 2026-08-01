---
type: source
title: "Introducing SkillOps: The Missing Lifecycle for AI Agent Skills"
author: "[[Vivek Haldar]]"
source_url: "https://www.youtube.com/watch?v=hpNp8mLO5QY"
source_type: video-transcript
published: 2026-07-13
ingested: 2026-07-31
tags:
  - source
  - agent-skills
  - skillops
  - governance
related:
  - "[[SkillOps]]"
  - "[[Agent Skills]]"
  - "[[SkillZBase]]"
  - "[[Intake-then-Curate Pattern]]"
---

# Introducing SkillOps: The Missing Lifecycle for AI Agent Skills

**Source**: YouTube, Vivek Haldar, 2026-07-13
**URL**: https://www.youtube.com/watch?v=hpNp8mLO5QY

## Summary

Vivek Haldar coins the term **SkillOps** to name the missing governance layer for AI agent skills. Skills are now the primary surface for building agents across enterprises, but current stacks (Claude, OpenAI, Gemini) only support authoring. Everything after — sharing, versioning, analytics, change requests, approval flows — is absent.

## Key Points

- Skills are the main vehicle for encoding company knowledge and building agents. Writing a skill is cheap; the lifecycle management is the hard part.
- The full skill lifecycle: **Author → Share → Measure → Change → Approve**. No major vendor implements this end-to-end.
- SkillOps is vendor-neutral. Implemented as an MCP gateway — skills served as resources, consumable by any agent stack that supports MCP.
- Domain experts can author and iterate on skills without touching Git, GitHub, or PRs. Change requests flow through an approval workflow instead.
- Skills should be treated as **first-class operational assets**: versioned, observable, governed — not as loose markdown files in a repo.

## Concepts

- [[SkillOps]]
- [[Agent Skills]]
- [[Skill Checklist Framework]] (related: authoring quality)
- [[Intake-then-Curate Pattern]] (Zühlke SkillZBase variant of the same problem)

## Entities

- [[Vivek Haldar]] — author, coined the term, founder of skillops.app
