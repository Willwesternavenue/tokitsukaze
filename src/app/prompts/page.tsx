import { redirect } from "next/navigation";

// 「プロンプト管理」は「AIスタッフ」に改名・再構成された
export default function PromptsRedirect() {
  redirect("/staff");
}
