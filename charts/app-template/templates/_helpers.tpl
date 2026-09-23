{{/*
Full resource name: "<appName>-<servicePostfix>". Single source of truth so every template
(and every consumer, e.g. apps/cms-api/helmfile.yaml) derives the same name the same way.
*/}}
{{- define "app-template.fullname" -}}
{{- printf "%s-%s" .Values.appName .Values.servicePostfix -}}
{{- end -}}

{{/*
Full namespace: "<namespaceBase>-prod". Hardcoded "-prod" suffix per this chart's current
single-environment convention — see apps/cms-api/SPEC.md's non-goals.
*/}}
{{- define "app-template.namespace" -}}
{{- printf "%s-prod" .Values.namespaceBase -}}
{{- end -}}

{{/*
Secret name consumed via envFrom. Uses .Values.secretName when set, otherwise defaults to
"<fullname>-secrets". The Secret itself is never created by this chart.
*/}}
{{- define "app-template.secretName" -}}
{{- if .Values.secretName -}}
{{- .Values.secretName -}}
{{- else -}}
{{- printf "%s-secrets" (include "app-template.fullname" .) -}}
{{- end -}}
{{- end -}}
