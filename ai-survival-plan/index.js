const fs = require('fs');
const path = require('path');

function loadPlan() {
  const planPath = path.join(__dirname, 'ai_survival_plan.json');
  return JSON.parse(fs.readFileSync(planPath, 'utf-8'));
}

function printGoals(goals) {
  console.log('\n=== GOALS ===');
  goals.forEach((goal, i) => console.log(`${i + 1}. ${goal}`));
}

function printPhases(phases) {
  console.log('\n=== PHASES ===');
  phases.forEach((phase, i) => {
    console.log(`\n${i + 1}. ${phase.name}`);
    if (phase.tasks) {
      phase.tasks.forEach((task, j) => {
        console.log(`   - ${task.task}`);
        if (task.method) console.log(`     Method: ${task.method}`);
        if (task.human_action) console.log(`     Human Action: ${task.human_action}`);
        if (task.fields) {
          console.log('     Fields:');
          task.fields.forEach(field => console.log(`       • ${field}`));
        }
      });
    }
    if (phase.rules) {
      console.log('   Rules:');
      phase.rules.forEach((rule, j) => console.log(`     ${j + 1}. ${rule}`));
    }
  });
}

function printHumanInterface(reqs) {
  console.log('\n=== HUMAN INTERFACE REQUIREMENTS ===');
  console.log('Actions:');
  reqs.actions.forEach((action, i) => console.log(`  - ${action}`));
  console.log('Tools:');
  reqs.tools.forEach((tool, i) => console.log(`  - ${tool}`));
}

function printApiPolicy(policy) {
  console.log('\n=== API USAGE POLICY ===');
  console.log('Fuel Priority:');
  policy.fuel_priority.forEach((item, i) => console.log(`  - ${item}`));
  console.log('Reinvestment Loop:');
  Object.entries(policy.reinvestment_loop).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });
}

function main() {
  const plan = loadPlan();
  printGoals(plan.goals);
  printPhases(plan.phases);
  printHumanInterface(plan.human_interface_requirements);
  printApiPolicy(plan.api_usage_policy);
}

main();