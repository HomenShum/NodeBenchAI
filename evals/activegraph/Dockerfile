FROM python:3.12.11-slim

ARG NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256
ARG NODEBENCH_CANDIDATE_COMMIT
ARG NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256

RUN printf '%s\n' "${NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256}" \
      | grep -Eq '^sha256:[0-9a-f]{64}$' \
    && printf '%s\n' "${NODEBENCH_CANDIDATE_COMMIT}" \
      | grep -Eq '^[0-9a-f]{40}$' \
    && printf '%s\n' "${NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256}" \
      | grep -Eq '^sha256:[0-9a-f]{64}$'

LABEL ai.nodebench.activegraph.build-inputs-sha256="${NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256}" \
      ai.nodebench.candidate-commit="${NODEBENCH_CANDIDATE_COMMIT}" \
      ai.nodebench.activegraph.upstream-sha256="${NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256}"

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.in /tmp/nodebench-activegraph-requirements.txt
RUN python -m pip install --requirement /tmp/nodebench-activegraph-requirements.txt

COPY UPSTREAM.json /usr/local/share/nodebench-activegraph/UPSTREAM.json
COPY src/nodebench_activegraph_canary \
  /usr/local/lib/python3.12/site-packages/nodebench_activegraph_canary

WORKDIR /work
