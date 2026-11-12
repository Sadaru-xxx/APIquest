# Java Silver 実行サンドボックス(JDK 17)
# 実行サーバーが1回の実行ごとに使い捨てコンテナとして起動する。単独では起動しない。
# 本番では公式イメージを digest で固定することを推奨(デプロイ手順書を参照)。
ARG BASE_IMAGE=eclipse-temurin:17-jdk-noble
FROM ${BASE_IMAGE}

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# 実行専用の非 root ユーザー(uid/gid 10001)
RUN (getent group 10001 >/dev/null || groupadd -g 10001 runner) \
 && (id -u 10001 >/dev/null 2>&1 || useradd -u 10001 -g 10001 -M -d /work -s /usr/sbin/nologin runner)

COPY --chmod=0555 run.sh /opt/runner/run.sh

USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/opt/runner/run.sh"]
