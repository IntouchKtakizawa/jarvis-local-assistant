export function calculate(expression){
 if(typeof expression!=='string'||!expression.trim()||expression.length>300)throw new Error('Use an arithmetic expression up to 300 characters.');
 const tokens=expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[()+\-*/^%,]/gi)||[];
 if(tokens.join('').toLowerCase()!==expression.replace(/\s+/g,'').toLowerCase())throw new Error('Unsupported character in the calculation.');
 let at=0,depth=0;const funcs={sqrt:Math.sqrt,abs:Math.abs,round:Math.round,floor:Math.floor,ceil:Math.ceil,min:Math.min,max:Math.max};
 const expressionValue=(min=0)=>{if(++depth>40)throw new Error('Calculation is too deeply nested.');let t=tokens[at++],v;
  if(t==='+'||t==='-')v=(t==='-'?-1:1)*expressionValue(30);
  else if(t==='('){v=expressionValue();if(tokens[at++]!==')')throw new Error('Missing closing parenthesis.');}
  else if(t&&/^\d|^\./.test(t))v=Number(t);
  else if(t?.toLowerCase()==='pi')v=Math.PI;
  else if(t?.toLowerCase()==='e')v=Math.E;
  else if(funcs[t?.toLowerCase()]){const f=funcs[t.toLowerCase()];if(tokens[at++]!=='(')throw new Error('A function needs parentheses.');const args=[expressionValue()];while(tokens[at]===','){at++;args.push(expressionValue());}if(tokens[at++]!==')')throw new Error('Missing closing parenthesis.');v=f(...args);}
  else throw new Error('Expected a number, arithmetic operator, or supported math function.');
  while(at<tokens.length){const op=tokens[at];if(op==='%'){at++;v/=100;continue;}const precedence={'+':10,'-':10,'*':20,'/':20,'^':40}[op];if(precedence===undefined||precedence<min)break;at++;const right=expressionValue(precedence+(op==='^'?0:1));v=op==='+'?v+right:op==='-'?v-right:op==='*'?v*right:op==='/'?v/right:v**right;}
  depth--;if(!Number.isFinite(v))throw new Error('The result is not a finite number.');return v;};
 const value=expressionValue();if(at!==tokens.length)throw new Error('Unexpected item in the expression.');return {expression,value:Number(value.toPrecision(14))};
}
