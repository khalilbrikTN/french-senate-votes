"""Response models for the /api/v1 endpoints."""

from datetime import date
from typing import Generic, Literal, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")
Position = Literal["pour", "contre", "abstention", "non_votant"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]


class SenatorSummary(BaseModel):
    id: str
    full_name: str
    first_name: str
    last_name: str
    title: Optional[str]
    status: Optional[Literal["ACTIF", "ANCIEN"]]
    group_code: Optional[str]
    group_name: Optional[str]
    department_name: Optional[str]
    department_code: Optional[str]
    avatar_url: Optional[str]
    senate_url: Optional[str]


class Mandate(BaseModel):
    start_date: date
    end_date: Optional[date]
    election_date: Optional[date]
    department_name: Optional[str]
    department_code: Optional[str]
    source_url: str


class GroupMembership(BaseModel):
    group_code: Optional[str]
    group_name: str
    # NULL when the official source did not record when the membership began.
    start_date: Optional[date]
    end_date: Optional[date]
    source_url: str


class VoteCounts(BaseModel):
    pour: int
    contre: int
    abstention: int
    non_votant: int
    total: int


class SenatorDetail(SenatorSummary):
    slug: Optional[str]
    commission: Optional[str]
    profession: Optional[str]
    social: dict
    mandates: list[Mandate]
    group_memberships: list[GroupMembership]
    vote_counts: VoteCounts


class GroupPresident(BaseModel):
    name: str
    # Senator matricule (see /api/v1/senators/{id}); null if the source names no senator.
    senator_id: Optional[str]
    since: date


class Group(BaseModel):
    code: str
    name: str
    # Display colour (#rrggbb) from political_group_display_settings; null if none is set.
    color: Optional[str]
    sitting_members: int
    # Current president from ODSEN_HISTOGROUPES; null when the group has none.
    president: Optional[GroupPresident]


class GroupDetail(Group):
    members: list[SenatorSummary]


class VoteSummary(BaseModel):
    session: str
    number: int
    vote_date: Optional[date]
    title: str
    result: str
    votes_for: int
    votes_against: int
    abstentions: int
    total: int
    source_url: str


class GroupVoteTotal(BaseModel):
    group_code: str
    group_name: str
    votes_for: int
    votes_against: int
    abstentions: int


class IndividualVote(BaseModel):
    senator_id: str
    senator_name: str
    position: Position
    # Derived from the senator's group memberships on the vote date.
    group_code: Optional[str]
    # Official reason for not voting, e.g. "Président de séance".
    special_status: Optional[str]
    # This senator also cast the vote of delegated_by_senator_id.
    delegated_by_senator_id: Optional[str]
    # The senator later stated they would have voted differently (official position unchanged).
    has_correction: bool


class VoteCorrection(BaseModel):
    display_order: int
    text: str
    session_record_url: Optional[str]


class VoteDetail(VoteSummary):
    group_totals: list[GroupVoteTotal]
    # Only senators sitting at import time have individual votes loaded.
    individual_votes: list[IndividualVote]
    corrections: list[VoteCorrection]


class SenatorVote(BaseModel):
    session: str
    number: int
    vote_date: Optional[date]
    title: str
    result: str
    position: Position
    group_code: Optional[str]
    special_status: Optional[str]
    delegated_by_senator_id: Optional[str]
    has_correction: bool


class Source(BaseModel):
    key: str
    value: dict
