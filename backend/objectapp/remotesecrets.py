"""Remote agents' secrets (M20): the one place that knows M19's secrets store for A2A.

A remote agent's bearer token or header value lives only in M19's ``<state>/secrets.json``
under the key ``a2a:<agentId>`` (`remotemodel.SECRET_KEY`). It never goes into a space, the
repo, ``agents.json``, ``agent.json``, ``card.json``, a transcript, a log line, an error message
or an API answer.

Imports no network client.
"""

from __future__ import annotations

from .appstate import state_dir
from .remotemodel import SECRET_KEY
from .secretstore import SecretStore

__all__ = ["get", "is_set", "put", "remove"]


def _key(agent_id: str) -> str:
    return SECRET_KEY.format(agent_id=agent_id)


def put(agent_id: str, value: str) -> None:
    """Store (or replace) the agent's secret."""
    SecretStore(state_dir()).set(_key(agent_id), value)


def get(agent_id: str) -> str | None:
    """The agent's secret, or None. Never writes."""
    return SecretStore(state_dir()).get(_key(agent_id))


def remove(agent_id: str) -> None:
    """Forget the agent's secret (nothing happens when there is none)."""
    SecretStore(state_dir()).delete(_key(agent_id))


def is_set(agent_id: str) -> bool:
    """Whether the agent has a secret. Never writes."""
    return SecretStore(state_dir()).has(_key(agent_id))
