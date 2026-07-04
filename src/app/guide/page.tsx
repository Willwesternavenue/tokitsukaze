"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProject } from "@/lib/storage";
import { getGenreConfig } from "@/lib/genreConfig";
import type { Genre } from "@/lib/types";

/**
 * 使い方ガイド。
 * 現在のプロジェクトのモード（ジャンル）に追従してステージ名を表示し、
 * 「各画面であなたが何をするか／AIが何を返すか／どこで調整するか」を明示する。
 * 迷いやすい中間ステップ（事前ヒアリング・構成の調整・波及反映）も1本の流れに載せる。
 */

type StepDef = {
  badge: string;
  sub?: boolean;
  title: string;
  where: string;
  you: string;
  ai: string;
  tune: string;
};

export default function GuidePage(): JSX.Element {
  const [genre, setGenre] = useState<Genre>("biography");

  useEffect(() => {
    try {
      setGenre(loadProject().genre ?? "biography");
    } catch {
      setGenre("biography");
    }
  }, []);

  const config = getGenreConfig(genre);
  const s = config.stages;

  const flow: { num: string; label: string; href: string; sub?: boolean }[] = [
    { num: "01", label: s.material.navLabel, href: "/" },
    { num: "＋", label: "事前ヒアリング", href: "/outline/interview", sub: true },
    { num: "02", label: s.structure.navLabel, href: "/outline" },
    { num: "＋", label: "構成の調整", href: "/outline/refine", sub: true },
    { num: "03", label: s.writing.navLabel, href: "/writer" },
    { num: "04", label: s.review.navLabel, href: "/review" },
  ];

  const steps: StepDef[] = [
    {
      badge: "01",
      title: s.material.pageTitle,
      where: "/",
      you: `モードを選び（現在は「${config.label}」）、プロジェクト名・${config.material.subjectLabel}・テーマ・想定読者・文体の希望を入力。「${config.material.panelTitle}」に素材をまとめて貼り付けます。`,
      ai: "この後のヒアリング・章立て・本文生成すべての土台にします。整形や要約はAIが行うので、素材は箇条書き・走り書きで構いません。",
      tune: `モードを変えると、ワークフローのラベル・ナレッジ項目・自動で走るAIスタッフが丸ごと切り替わります。素材は ${config.material.help.includes("20,000") ? "20,000字以内が目安（40,000字超でタイムアウトの恐れ）" : "長すぎるとタイムアウトの恐れ"}。`,
    },
    {
      badge: "＋",
      sub: true,
      title: "事前ヒアリング（任意）",
      where: "/outline/interview",
      you: "「章立て案を生成する」を押すと、この画面でAIが3〜10問の確認を投げます。答えても、スキップしても、曖昧な回答でもOK。",
      ai: "回答を踏まえて章立ての精度を上げます。ここで方向性を握っておくと、後の調整作業が減ります。",
      tune: "急ぐときは全部スキップして先に進めます。回答は多いほど後工程が楽になる、という位置づけです。",
    },
    {
      badge: "02",
      title: s.structure.pageTitle,
      where: "/outline",
      you: `提示された3案（${outlineTypeText(config)}）から、方向性が近い1案を選びます。`,
      ai: "選んだ構成の各章に、小見出し（節）を自動で割り付けます。",
      tune: "この時点ではまだ本文は作りません。案が今ひとつなら、次の「構成の調整」で直せます。作り直したいときは 01 に戻って素材を足してから再生成。",
    },
    {
      badge: "＋",
      sub: true,
      title: "構成の調整（任意）",
      where: "/outline/refine",
      you: "選んだ構成を、①全体まとめてAI改善、②章ごとに指示して修正、③手で直接編集、の3通りで整えます。",
      ai: "「もっと初心者向けに」「第3章を2つに分けて」といった日本語の指示を、章構成に反映します。",
      tune: "構成はこの画面で固めてから執筆に進むのがおすすめ。骨格が決まっていれば、本文のブレが減ります。",
    },
    {
      badge: "03",
      title: s.writing.pageTitle,
      where: "/writer",
      you: "左の目次から小見出しをクリックすると本文を生成。小見出し自体を編集して「AI修正」で整え、それを土台に本文を作ることもできます。",
      ai: "本文と一緒に、編集メモ・確認質問・（モードに応じて）事実確認や整合性の指摘を返します。",
      tune: "小見出しを直すと、下流の節が古いままになりがち。編集後に『波及反映』を使うと、影響を受ける節を検出して連鎖再生成します。手で仕上げた節は『ロック』しておけば再生成から保護されます。",
    },
    {
      badge: "04",
      title: s.review.pageTitle,
      where: "/review",
      you: "AI編集部（自動レビュアー）の診断を、担当ごとのタブで確認します。",
      ai: config.stages.review.description,
      tune: "指摘を直して本文を作り直すと、整合が取れた項目は「解決済み」として表示されます。走るレビュアーは AIスタッフ画面でON/OFFでき、トークンを節約できます。",
    },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>使い方</h1>
          <p className="subtitle">
            素材を入れてから本になるまでの流れと、各画面で「あなたが何をするか」を確認できます。
            現在のモード: <strong>{config.label}</strong>
          </p>
        </div>
      </div>

      {/* 全体の流れ */}
      <div className="panel">
        <div className="panel-header">
          <h2>全体の流れ</h2>
          <span className="hint">クリックでその画面へ移動できます</span>
        </div>
        <div className="panel-body">
          <div className="guide-flow">
            {flow.map((n, i) => (
              <span key={n.href + i} style={{ display: "inline-flex" }}>
                <Link href={n.href} className={`guide-node ${n.sub ? "sub" : ""}`}>
                  <span className="guide-node-num">{n.num}</span>
                  <span className="guide-node-label">{n.label}</span>
                </Link>
                {i < flow.length - 1 ? <span className="guide-arrow">→</span> : null}
              </span>
            ))}
          </div>
          <p className="help" style={{ marginTop: 10 }}>
            <strong>01 / 02 / 03 / 04</strong> がメインの4ステップ。点線の <strong>事前ヒアリング</strong> と{" "}
            <strong>構成の調整</strong> は、精度を上げるための任意の中間ステップです（飛ばして先に進めます）。
            ナビ上部の番号タブと同じ並びです。
          </p>
        </div>
      </div>

      {/* 各ステップで、あなたがやること */}
      <div className="panel">
        <div className="panel-header">
          <h2>各ステップで、あなたがやること</h2>
          <span className="hint">
            <span className="badge" style={{ marginRight: 4 }}>あなた</span>
            <span className="badge success" style={{ marginRight: 4 }}>AI</span>
            <span className="badge warn">調整のコツ</span>
          </span>
        </div>
        <div className="panel-body dense">
          {steps.map((st) => (
            <div className="guide-step" key={st.badge + st.title}>
              <div className="guide-step-head">
                <span className={`guide-step-badge ${st.sub ? "sub" : ""}`}>{st.badge}</span>
                <span className="guide-step-title">{st.title}</span>
                <span className="guide-step-where">{st.where}</span>
              </div>
              <dl className="guide-io">
                <dt><span className="tagdot you" />あなた</dt>
                <dd>{st.you}</dd>
                <dt><span className="tagdot ai" />AI</dt>
                <dd>{st.ai}</dd>
                <dt><span className="tagdot tune" />調整</dt>
                <dd>{st.tune}</dd>
              </dl>
            </div>
          ))}
        </div>
      </div>

      {/* 3つの概念 */}
      <div className="panel">
        <div className="panel-header">
          <h2>3つの登場人物（ここを分けて考えると迷いません）</h2>
        </div>
        <div className="panel-body">
          <div className="grid grid-3">
            <div className="guide-concept">
              <h3>AIスタッフ</h3>
              <div className="guide-concept-tag">＝ 実行される役割</div>
              <p style={{ margin: 0, fontSize: 12 }}>
                構成・執筆を進める担当と、本文を点検する自動レビュアー。
                <Link href="/staff">AIスタッフ</Link> 画面で、プロジェクトごとにON/OFFできます（無効化でトークン節約）。
              </p>
            </div>
            <div className="guide-concept">
              <h3>ナレッジ</h3>
              <div className="guide-concept-tag">＝ 参照される材料</div>
              <p style={{ margin: 0, fontSize: 12 }}>
                スタッフが執筆・点検時に読む設定資料。ナビの「ナレッジ▾」に入っています。
                現在のモードでは:{" "}
                {config.knowledge.map((k, i) => (
                  <span key={k.href}>
                    {i > 0 ? "・" : ""}
                    <Link href={k.href}>{k.label}</Link>
                  </span>
                ))}
                。
              </p>
            </div>
            <div className="guide-concept">
              <h3>ルールブック</h3>
              <div className="guide-concept-tag">＝ 注入される編集方針</div>
              <p style={{ margin: 0, fontSize: 12 }}>
                校正・文体・てにをは・ですます調などの方針。単独では実行されず、各スタッフに自動で注入されます。
                <Link href="/staff">AIスタッフ</Link> 画面の「ルールブック」欄で編集できます。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 困ったとき */}
      <div className="panel">
        <div className="panel-header">
          <h2>困ったとき</h2>
        </div>
        <div className="panel-body dense">
          <details className="guide-faq">
            <summary>途中で「次に何を変えればいいか」わからなくなった</summary>
            <div className="guide-faq-body">
              上の「全体の流れ」で今いる画面を確認してください。困ったら基本は
              <strong> 01 素材 → 02 構成（＝骨格）→ 03 執筆 → 04 レビュー</strong> の順に、
              前の段が固まってから次へ進みます。骨格（構成）が緩いまま本文を作ると後で崩れやすいので、
              迷ったら一段戻って <Link href="/outline/refine">構成の調整</Link> を整えるのが近道です。
            </div>
          </details>
          <details className="guide-faq">
            <summary>小見出しを直したら、以降の文章と噛み合わなくなった</summary>
            <div className="guide-faq-body">
              <Link href="/writer">執筆</Link> 画面で小見出しを編集したあと『波及反映』を実行すると、
              影響を受ける下流の節を検出して連鎖再生成します。手で仕上げた節は『ロック』しておけば、
              再生成から保護されます。
            </div>
          </details>
          <details className="guide-faq">
            <summary>生成に失敗する／途中で止まる</summary>
            <div className="guide-faq-body">
              素材が長すぎるとサーバのタイムアウト（最大180秒）に達することがあります。まずは素材を
              20,000字程度に分け、必要ならプロジェクトを分けてください。一時的なエラーはもう一度実行すると
              通ることが多いです。
            </div>
          </details>
          <details className="guide-faq">
            <summary>トークン（コスト）を節約したい</summary>
            <div className="guide-faq-body">
              <Link href="/staff">AIスタッフ</Link> 画面のレビュー欄で、使わない自動レビュアーを無効にできます。
              本文生成1回あたりに走るレビュアーの数が減り、そのぶん節約になります。設定はプロジェクトごとに保存されます。
            </div>
          </details>
          <details className="guide-faq">
            <summary>別の本を作りたい／作品を切り替えたい</summary>
            <div className="guide-faq-body">
              画面上部のプロジェクト切替から、新規作成・切り替えができます。過去作の文体や設定を引き継ぎたいときは、
              <Link href="/library">参照ライブラリ</Link> に前作を登録し、執筆時に参照先として選びます（続編づくりに便利）。
            </div>
          </details>
          <details className="guide-faq">
            <summary>データはどこに保存される？ バックアップは？</summary>
            <div className="guide-faq-body">
              各プロジェクトはお使いのブラウザ内（localStorage）に自動保存されます。別の端末へ移す・保険を取るには、
              プロジェクト切替メニューの JSON エクスポート／インポートを使ってください（参照ライブラリも一緒に移行できます）。
            </div>
          </details>
        </div>
      </div>
    </>
  );
}

function outlineTypeText(config: ReturnType<typeof getGenreConfig>): string {
  const l = config.outlineTypeLabels;
  if (l) return `${l.chronological}／${l.thematic}／${l.narrative}`;
  return "時系列型／テーマ型／人物伝型";
}
