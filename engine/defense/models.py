from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(Strict):
    chunk_id: str
    quote: str = Field(max_length=6000)


class Claim(Strict):
    text: str = Field(max_length=30000)
    kind: Literal["documented_fact", "inference", "proposed_argument", "unknown"]
    citations: list[Citation] = Field(max_length=30)
    review_note: str = Field(max_length=6000)


class Section(Strict):
    heading: str = Field(max_length=1000)
    claims: list[Claim] = Field(max_length=150)


class Artifact(Strict):
    filename: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}\.(docx|xlsx)$")
    title: str
    sections: list[Section] = Field(max_length=100)


class Draft(Strict):
    facts: list[Claim] = Field(max_length=250)
    artifacts: list[Artifact] = Field(min_length=1, max_length=8)
    issues: list[str] = Field(max_length=200)


class Verdict(Strict):
    reasoning: str
    verdict: Literal["pass", "fail"]


class FactSet(Strict):
    facts: list[Claim] = Field(max_length=250)
    issues: list[str] = Field(max_length=200)


WORKFLOWS = {
    "discovery_responses": "Identify every request and its exact number. Draft a separate response, narrowly supported objections, and review items for each. Distinguish admissions, denials, inability to answer, and documents to produce. Flag missing verification, custodians, search scope, dates, privilege bases and legal research. Do not invent objections or legal authorities.",
    "chronology": "Order dated events chronologically, preserving uncertain dates and conflicting records. Explain material relationships and source each event. Separate contemporaneous evidence from retrospective accounts.",
    "deposition_analysis": "Identify material admissions and contradictions with exact quoted testimony and available transcript page/line identifiers in the source; do not invent transcript lines. Explain significance as inference and identify follow-up questions.",
    "case_assessment": "Analyze supplied claims, defenses, damages and exposure. Distinguish evidence from inference. Identify unresolved issues and next investigative steps. Flag unsupplied legal authority for attorney research.",
    "document_review": "Classify every supplied document for relevance and potential privilege. Provide a reviewable privilege log with supported fields and unknowns. Do not assert privilege as established merely because a lawyer is copied.",
    "production_completeness": "Map each discovery request to responses and production, flag missing categories and contradictory records. Identify supported gaps and recommended follow-up, preserving request identifiers.",
    "deposition_preparation": "Create an issue-based deposition outline grounded in exhibits and unresolved facts.",
    "request_review": "Review each request for scope and supported objection issues; propose specific responses.",
    "privilege_review": "Review privilege and clawback candidates with document-specific support and uncertainty.",
    "invoice_compliance": "Compare each supplied invoice entry to supplied billing rules and show calculations.",
    "motion_drafting": "Draft from supplied facts and authorities; flag research and unsupported arguments.",
    "coverage_opinion": "Analyze supplied policy language and facts; keep coverage distinct from liability.",
    "reservation_of_rights": "Draft a reservation from supplied policy and facts, flag research and uncertainty.",
    "coverage_review": "Review the denial against supplied policy and records; flag unsupported conclusions.",
}
